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

    emscripten::val verify() {
        if(example_input_data.empty() || example_output_data.empty()){
            emscripten::val ret = emscripten::val::object();
            ret.set("pass", false); ret.set("error", std::string("no example data")); return ret;
        }
        rlt::dyn::Tensor<rlt::dyn::TensorSpecification<TI>> input_tensor;
        TI in_shape[] = {(TI)1, input_dim};
        rlt::dyn::set_shape(input_tensor, (TI)2, in_shape);
        input_tensor.type = rlt::dyn::Type::FLOAT32;
        input_tensor.data = example_input_data.data();

        rlt::dyn::Tensor<rlt::dyn::TensorSpecification<TI>> output_tensor;
        TI out_shape[] = {(TI)output_dim};
        rlt::dyn::set_shape(output_tensor, (TI)1, out_shape);
        output_tensor.type = rlt::dyn::Type::FLOAT32;
        output_tensor.data = output_cache.data();
        output_tensor.capacity = output_cache.size();

        rlt::evaluate(device, model, input_tensor, output_tensor, buffer);

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
        .function("create_state", &DynInference::create_state)
        .function("reset_state", &DynInference::reset_state)
        .function("evaluate_step", &DynInference::evaluate_step)
        .function("evaluate", &DynInference::evaluate)
        .function("verify", &DynInference::verify)
        .function("destroy", &DynInference::destroy);
}
