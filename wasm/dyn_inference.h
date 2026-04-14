#pragma once

#include <rl_tools/operations/cpu.h>
#include <rl_tools/persist/backends/hdf5/hdf5.h>
#include <rl_tools/persist/backends/hdf5/operations_cpu.h>
#include <rl_tools/dyn/persist.h>

#include <emscripten/bind.h>

#include <vector>
#include <string>
#include <cmath>

namespace rlt = rl_tools;

struct DynInference {
    using DEVICE = rlt::devices::DefaultCPU;
    using TI = typename DEVICE::index_t;

    DEVICE device;
    rlt::dyn::Layer<TI> model;
    rlt::dyn::Buffer<TI> buffer;
    std::vector<rlt::dyn::State<TI>> states;
    TI input_dim = 0;
    TI output_dim = 0;
    std::string checkpoint_name;
    std::string meta_json;
    bool loaded = false;
    std::vector<float> output_cache;
    std::vector<float> example_input_data;
    std::vector<float> example_output_data;

    bool load(const std::string& path) {
        if(loaded) destroy();
        rlt::persist::backends::hdf5::File file(path.c_str(), rlt::persist::backends::hdf5::Mode::READ);
        if(file.id < 0) return false;

        auto actor_group = rlt::get_group(device, file, "actor");

        char attr_buf[4096];
        rlt::persist::backends::hdf5::detail::read_string_attribute(actor_group.id, "checkpoint_name", attr_buf, sizeof(attr_buf));
        checkpoint_name = attr_buf;
        rlt::persist::backends::hdf5::detail::read_string_attribute(actor_group.id, "meta", attr_buf, sizeof(attr_buf));
        meta_json = attr_buf;

        if(!rlt::load(device, model, actor_group)) return false;

        // Load example input/output data
        hid_t example_group_id = H5Gopen2(file.id, "example", H5P_DEFAULT);
        if(example_group_id >= 0){
            hid_t ds_in = H5Dopen2(example_group_id, "input", H5P_DEFAULT);
            if(ds_in >= 0){
                hid_t space = H5Dget_space(ds_in);
                int rank = H5Sget_simple_extent_ndims(space);
                hsize_t dims[5];
                H5Sget_simple_extent_dims(space, dims, nullptr);
                input_dim = dims[rank - 1];
                TI total_in = 1; for(int d = 0; d < rank; d++) total_in *= dims[d];
                example_input_data.resize(total_in);
                H5Dread(ds_in, H5T_NATIVE_FLOAT, H5S_ALL, H5S_ALL, H5P_DEFAULT, example_input_data.data());
                H5Sclose(space);
                H5Dclose(ds_in);
            }
            hid_t ds_out = H5Dopen2(example_group_id, "output", H5P_DEFAULT);
            if(ds_out >= 0){
                hid_t space_out = H5Dget_space(ds_out);
                int rank_out = H5Sget_simple_extent_ndims(space_out);
                hsize_t dims_out[5];
                H5Sget_simple_extent_dims(space_out, dims_out, nullptr);
                TI total_out = 1; for(int d = 0; d < rank_out; d++) total_out *= dims_out[d];
                example_output_data.resize(total_out);
                H5Dread(ds_out, H5T_NATIVE_FLOAT, H5S_ALL, H5S_ALL, H5P_DEFAULT, example_output_data.data());
                H5Sclose(space_out);
                H5Dclose(ds_out);
            }
            H5Gclose(example_group_id);
        }

        TI input_shape[] = {1, input_dim};
        rlt::dyn::propagate_shapes(model, input_shape, (TI)2);
        output_dim = model.output_shape[model.output_rank - 1];

        buffer.layer = &model;
        rlt::malloc(device, buffer);

        output_cache.resize(model.output_size);
        loaded = true;
        return true;
    }

    std::string get_checkpoint_name() const { return checkpoint_name; }
    std::string get_meta() const { return meta_json; }
    int get_input_dim() const { return (int)input_dim; }
    int get_output_dim() const { return (int)output_dim; }

    int get_num_branches() const {
        if(model.type == rlt::dyn::LayerType::PARALLEL && model.data){
            auto& p = model.template as<const rlt::dyn::layers::Parallel<TI>>();
            if(p.num_input_dims > 0) return (int)p.num_input_dims;
        }
        return 1;
    }

    emscripten::val get_input_dims() const {
        emscripten::val arr = emscripten::val::array();
        if(model.type == rlt::dyn::LayerType::PARALLEL && model.data){
            auto& p = model.template as<const rlt::dyn::layers::Parallel<TI>>();
            for(TI i = 0; i < p.num_input_dims; i++) arr.set((unsigned)i, (int)p.input_dims[i]);
            if(p.num_input_dims > 0) return arr;
        }
        arr.set(0u, (int)input_dim);
        return arr;
    }

    int create_state() {
        rlt::dyn::State<TI> state;
        state.batch_size = 1;
        state.layer = &model;
        rlt::malloc(device, state);
        states.push_back(std::move(state));
        return (int)(states.size() - 1);
    }

    void reset_state(int id) {
        if(id < 0 || id >= (int)states.size()) return;
        rlt::reset(device, model, states[id]);
    }

    emscripten::val evaluate_step(int state_id, emscripten::val js_input) {
        unsigned int len = js_input["length"].as<unsigned int>();
        std::vector<float> input_data(len);
        emscripten::val heap_view = emscripten::val(emscripten::typed_memory_view(len, input_data.data()));
        heap_view.call<void>("set", js_input);

        rlt::dyn::Tensor<rlt::dyn::TensorSpecification<TI>> input_tensor;
        TI input_shape[] = {(TI)1, (TI)len};
        rlt::dyn::set_shape(input_tensor, (TI)2, input_shape);
        input_tensor.type = rlt::dyn::Type::FLOAT32;
        input_tensor.data = input_data.data();

        rlt::dyn::Tensor<rlt::dyn::TensorSpecification<TI>> output_tensor;
        TI output_shape[] = {(TI)model.output_size};
        rlt::dyn::set_shape(output_tensor, (TI)1, output_shape);
        output_tensor.type = rlt::dyn::Type::FLOAT32;
        output_tensor.data = output_cache.data();
        output_tensor.capacity = output_cache.size();

        if(state_id >= 0 && state_id < (int)states.size()){
            rlt::evaluate_step(device, model, input_tensor, states[state_id], output_tensor, buffer);
        } else {
            rlt::evaluate(device, model, input_tensor, output_tensor, buffer);
        }

        return emscripten::val(emscripten::typed_memory_view(output_dim, output_cache.data()));
    }

    emscripten::val evaluate(emscripten::val js_input) {
        return evaluate_step(-1, js_input);
    }

    void infer_branch_shape(const rlt::dyn::Layer<TI>& branch, TI dim, TI* shape, TI& rank) {
        const rlt::dyn::Layer<TI>* first = &branch;
        while(first->num_children > 0 && (first->type == rlt::dyn::LayerType::SEQUENTIAL || first->type == rlt::dyn::LayerType::MLP))
            first = &first->children[0];
        if(first->type == rlt::dyn::LayerType::CONV2D){
            auto& conv = first->template as<const rlt::dyn::layers::Conv2d<TI>>();
            TI ic = conv.input_channels;
            TI spatial = (ic > 0) ? dim / ic : 0;
            TI side = 1; while(side * side < spatial) side++;
            if(spatial > 0 && side * side == spatial){
                shape[0] = 1; shape[1] = side; shape[2] = side; shape[3] = ic; rank = 4; return;
            }
        }
        shape[0] = 1; shape[1] = dim; rank = 2;
    }

    emscripten::val evaluate_tuple(emscripten::val js_inputs) {
        unsigned int n = js_inputs["length"].as<unsigned int>();
        if(n > rlt::dyn::TensorTuple<TI>::MAX_TENSORS) n = rlt::dyn::TensorTuple<TI>::MAX_TENSORS;

        std::vector<std::vector<float>> storage(n);
        rlt::dyn::TensorTuple<TI> tuple;
        tuple.num_tensors = n;
        for(unsigned int i = 0; i < n; i++){
            emscripten::val js_in = js_inputs[i];
            unsigned int len = js_in["length"].as<unsigned int>();
            storage[i].resize(len);
            emscripten::val heap_view = emscripten::val(emscripten::typed_memory_view(len, storage[i].data()));
            heap_view.call<void>("set", js_in);

            TI shape[5]; TI rank;
            if(model.type == rlt::dyn::LayerType::PARALLEL && i < model.num_children){
                infer_branch_shape(model.children[i], (TI)len, shape, rank);
            } else {
                shape[0] = 1; shape[1] = len; rank = 2;
            }
            rlt::dyn::set_shape(tuple.tensors[i], rank, shape);
            tuple.tensors[i].type = rlt::dyn::Type::FLOAT32;
            tuple.tensors[i].data = storage[i].data();
            tuple.tensors[i].capacity = len;
        }

        rlt::dyn::Tensor<rlt::dyn::TensorSpecification<TI>> output_tensor;
        TI output_shape[] = {(TI)model.output_size};
        rlt::dyn::set_shape(output_tensor, (TI)1, output_shape);
        output_tensor.type = rlt::dyn::Type::FLOAT32;
        output_tensor.data = output_cache.data();
        output_tensor.capacity = output_cache.size();

        rlt::evaluate(device, model, tuple, output_tensor, buffer);
        return emscripten::val(emscripten::typed_memory_view(output_dim, output_cache.data()));
    }

    emscripten::val verify() {
        if(example_input_data.empty() || example_output_data.empty()){
            emscripten::val ret = emscripten::val::object();
            ret.set("pass", false); ret.set("error", std::string("no example data")); return ret;
        }
        rlt::dyn::Tensor<rlt::dyn::TensorSpecification<TI>> output_tensor;
        TI out_shape[] = {(TI)output_dim};
        rlt::dyn::set_shape(output_tensor, (TI)1, out_shape);
        output_tensor.type = rlt::dyn::Type::FLOAT32;
        output_tensor.data = output_cache.data();
        output_tensor.capacity = output_cache.size();

        bool use_tuple = false;
        TI num_branches = 0;
        const rlt::dyn::layers::Parallel<TI>* parallel_data = nullptr;
        if(model.type == rlt::dyn::LayerType::PARALLEL && model.data){
            parallel_data = &model.template as<const rlt::dyn::layers::Parallel<TI>>();
            num_branches = parallel_data->num_input_dims;
            if(num_branches >= 2) use_tuple = true;
        }

        if(use_tuple){
            rlt::dyn::TensorTuple<TI> tuple;
            tuple.num_tensors = num_branches;
            TI offset = 0;
            for(TI i = 0; i < num_branches; i++){
                TI dim = parallel_data->input_dims[i];
                TI shape[5]; TI rank;
                infer_branch_shape(model.children[i], dim, shape, rank);
                rlt::dyn::set_shape(tuple.tensors[i], rank, shape);
                tuple.tensors[i].type = rlt::dyn::Type::FLOAT32;
                tuple.tensors[i].data = example_input_data.data() + offset;
                tuple.tensors[i].capacity = dim;
                offset += dim;
            }
            rlt::evaluate(device, model, tuple, output_tensor, buffer);
        } else {
            rlt::dyn::Tensor<rlt::dyn::TensorSpecification<TI>> input_tensor;
            TI in_shape[] = {(TI)1, input_dim};
            rlt::dyn::set_shape(input_tensor, (TI)2, in_shape);
            input_tensor.type = rlt::dyn::Type::FLOAT32;
            input_tensor.data = example_input_data.data();
            rlt::evaluate(device, model, input_tensor, output_tensor, buffer);
        }

        float max_diff = 0;
        for(size_t i = 0; i < example_output_data.size() && i < output_dim; i++){
            float diff = std::abs(output_cache[i] - example_output_data[i]);
            if(diff > max_diff) max_diff = diff;
        }
        emscripten::val ret = emscripten::val::object();
        ret.set("max_diff", max_diff);
        ret.set("pass", max_diff < 1e-4f);
        ret.set("expected", emscripten::val(emscripten::typed_memory_view(example_output_data.size(), example_output_data.data())));
        ret.set("actual", emscripten::val(emscripten::typed_memory_view(output_dim, output_cache.data())));
        return ret;
    }

    void destroy() {
        if(!loaded) return;
        for(auto& s : states) rlt::free(device, s);
        states.clear();
        rlt::free(device, buffer);
        rlt::free(device, model);
        output_cache.clear();
        loaded = false;
        input_dim = 0;
        output_dim = 0;
    }

    ~DynInference() { destroy(); }
};

EMSCRIPTEN_BINDINGS(dyn_inference_module) {
    emscripten::class_<DynInference>("DynInference")
        .constructor<>()
        .function("load", &DynInference::load)
        .function("get_checkpoint_name", &DynInference::get_checkpoint_name)
        .function("get_meta", &DynInference::get_meta)
        .function("get_input_dim", &DynInference::get_input_dim)
        .function("get_output_dim", &DynInference::get_output_dim)
        .function("get_num_branches", &DynInference::get_num_branches)
        .function("get_input_dims", &DynInference::get_input_dims)
        .function("create_state", &DynInference::create_state)
        .function("reset_state", &DynInference::reset_state)
        .function("evaluate_step", &DynInference::evaluate_step)
        .function("evaluate", &DynInference::evaluate)
        .function("evaluate_tuple", &DynInference::evaluate_tuple)
        .function("verify", &DynInference::verify)
        .function("destroy", &DynInference::destroy);
}
