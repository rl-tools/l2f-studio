import {L2F} from "./l2f.js"
import * as rlt from "./lib/rltools.js"
import * as math from "mathjs"

// check url for "file" parameter
const urlParams = new URLSearchParams(window.location.search);
const file = urlParams.get('file');
const file_url = file ? file : "./blob/checkpoint.h5"
function mean(a){
    return a.reduce((sum, val) => sum + val, 0) / a.length
}
function std(x){
    const sample_mean = mean(x)
    const variance = x.reduce((sum, val) => sum + (val - sample_mean) ** 2, 0)
    return variance > 0 ?  Math.sqrt(variance / x.length) : 0;
}

let model = null
async function main(){
    const seed = 12
    if(model === null){
        model = await rlt.load(file_url)
    }
    const policy_state = {
        "step": 0
    }
    function lissajous(t){
        const scale = 0.5
        const duration = 10
        const A = 1
        const B = 0.5
        const progress = t * 2 * Math.PI / duration
        const d_progress = 2 * Math.PI / duration
        const x = scale * Math.sin(A * progress)
        const y = scale * Math.sin(B * progress)
        const vx = scale * Math.cos(A * progress) * A * d_progress
        const vy = scale * Math.cos(B * progress) * B * d_progress
        return [x, y, 0, vx, vy, 0]
    }
    function default_trajectory(t){
        return [0, 0, 0, 0, 0, 0]
    }
    function policy(state){
        state.observe()
        const input = math.matrix([[[...Array(state.observation_dim).keys()].map(i => state.get_observation(i))]])
        const input_offset = default_trajectory(policy_state.step / 100)
        input_offset.forEach((x, i) => {
            input._data[0][0][i] = input._data[0][0][i] - x
        })
        const output = model.evaluate(input)
        policy_state.step += 1
        return output.valueOf()[0][0]
    }
    const sim_container = document.getElementById("sim-container")
    const l2f = new L2F(sim_container, 10, policy, seed)

    const get_values_from_path = (path) => {
        const objs = l2f.states.map(state => {
            return {
                "state": JSON.parse(state.get_state()),
                "parameters": JSON.parse(state.get_parameters())
            }
        })
        return path.split('.').reduce((acc, key) => key === "" ? acc : (acc && acc[0][key] !== undefined ? acc.map(x => x[key]) : undefined), objs);
    }
    const set_values_at_path = (instructions, new_value) => {
        const objs = l2f.states.map(state => {
            return {
                "state": JSON.parse(state.get_state()),
                "parameters": JSON.parse(state.get_parameters())
            }
        })
        if(typeof instructions === "string"){
            const path = instructions
            instructions = {}
            instructions[path] = new_value
        }
        const additional_instructions = {}
        for(const [path_string, value] of Object.entries(instructions)){
            const check_path = "parameters.dynamics.J"
            if(path_string.startsWith(check_path)){
                const values = Array.isArray(value) ? value.map(x => 1/x) : 1/value
                additional_instructions["parameters.dynamics.J_inv" + path_string.slice(check_path.length)] = values
            }
        }
        const combined_instructions = {...instructions, ...additional_instructions}
        // Object.entries(additional_instructions).forEach(([path_string, value]) => {
        //     instructions[path_string] = value
        // })
        for(const [path_string, value] of Object.entries(combined_instructions)){
            const path = path_string.split('.')
            const last_key = path.pop()
            const target_objs = path.reduce((acc, key) => acc.map(x => x[key]), objs)
            target_objs.forEach((obj, i) => {
                if(Array.isArray(value)){
                    obj[last_key] = value[i]
                }
                else{
                    obj[last_key] = value 
                }
            })
        }
        l2f.states.forEach((state, i) => state.set_state(JSON.stringify(objs[i].state)))
        l2f.states.forEach((state, i) => state.set_parameters(JSON.stringify(objs[i].parameters)))
    }

    const num_vehicles_input = document.getElementById("num-vehicles")
    num_vehicles_input.addEventListener("input", async () => {
        const diff = await l2f.change_num_quadrotors(parseInt(num_vehicles_input.value))
        const perturbation_groups = document.getElementById("perturbation-groups")
        const elements = Array.from(perturbation_groups.querySelectorAll(":scope ul > li"))
        if(diff < 0){
            elements.forEach(el => {
                el.original_values = el.original_values.slice(0, diff)
            })
        }
        else{
            elements.forEach(el => {
                el.original_values = el.original_values.concat(get_values_from_path(el.path).slice(-diff))
            })
        }
    })

    const speed_slider = document.getElementById("speed-slider")
    const speed_info = document.getElementById("speed-info")
    const speed_info_real = document.getElementById("speed-info-real")
    speed_slider.addEventListener("input", () => {
        const normalized_value = parseFloat(speed_slider.value)
        const range = 9;
        const factor = normalized_value > 0.5 ? (1 + (normalized_value - 0.5) * 2 * range) : (1 + (0.5 - normalized_value) * 2 * range)
        l2f.speed = normalized_value > 0.5 ? factor : 1 / factor
        speed_info.innerText = `Speed: ${normalized_value > 0.5 ? factor.toFixed(1) : (normalized_value === 0.5 ? "1" : `1/${factor.toFixed(1)}`)}x`
    })
    setInterval(() => {
        const f = l2f.real_time_factor
        if(f){
            speed_info_real.innerText = `(${f > 1 ? f.toFixed(1) : `1/${(1/f).toFixed(1)}`}x)`
        }
        else{
            speed_info_real.innerText = `(-)`
        }
    }, 100)

    const show_axes_checkbox = document.getElementById("show-axes")
    show_axes_checkbox.addEventListener("change", () => {
        l2f.initialized.then(() => {
            l2f.ui_state.showAxes = show_axes_checkbox.checked
            l2f.ui.episode_init_multi(l2f.ui_state, l2f.parameters)
        })
    })

    const pause_on_reset_checkbox = document.getElementById("pause-on-reset")
    const sample_initial_states_button = document.getElementById("sample-initial-states")
    sample_initial_states_button.addEventListener("click", () => {
        l2f.states.forEach(state => {
            if(pause_on_reset_checkbox.checked && pause_button.innerText === "Pause"){
                pause_button.innerText = "Resume"
                l2f.request_pause = true
            }
            state.sample_initial_state()
        })
    })
    const pause_button = document.getElementById("pause")
    pause_button.addEventListener("click", () => {
        if(pause_button.innerText === "Pause"){
            pause_button.innerText = "Resume"
            l2f.request_pause = true
        }
        else{
            pause_button.innerText = "Pause"
            l2f.request_unpause = true
        }
    })
    const step_button = document.getElementById("step")
    step_button.addEventListener("click", () => {
        if(pause_button.innerText === "Pause"){
            pause_button.innerText = "Resume"
            l2f.request_pause = true
        }
        l2f.simulate_step()
    })

    const perturbation_id_input = document.getElementById("perturbation-id-input")
    const perturbation_id_status = document.getElementById("perturbation-id-status")
    const perturbation_id_min = document.getElementById("perturbation-id-min")
    const perturbation_id_max = document.getElementById("perturbation-id-max")
    const perturbation_transform = document.getElementById("perturbation-transform")
    const perturbation_id_suggestion = document.getElementById("perturbation-id-suggestion")
    const perturbation_groups = document.getElementById("perturbation-groups")
    const perturbation_group_template = document.getElementById("perturbation-group-template")
    perturbation_id_input.addEventListener("input", () => {
        const parent_path = perturbation_id_input.value.split('.').slice(0, -1).join('.')
        const found_values = get_values_from_path(perturbation_id_input.value)
        let parent = get_values_from_path(parent_path)
        if(parent !== undefined && (typeof parent[0] === "object")){
            let current_key = perturbation_id_input.value.split('.').slice(-1)[0]
            let foresight = false
            if(current_key in parent[0]){
                parent = parent.map(x => x[current_key])
                foresight = true
                current_key = ""
            }
            const suggestions = Object.keys(parent[0]).sort().reduce((acc, key) => {
                if(key.startsWith(current_key)){
                    acc.push(key)
                }
                return acc
            }, [])
            if(suggestions.length > 0){
                const marked_suggestions = suggestions.map(x => {
                    return (foresight ? "." : "") + "<b>" + current_key + "</b>" + x.slice(current_key.length)
                })
                perturbation_id_suggestion.innerHTML = "Subgroups: " + marked_suggestions.join(", ")
            }
            else{
                if(found_values === undefined){
                    perturbation_id_suggestion.innerText = "Subgroups: " + "not found"
                }
                else{
                    if(found_values.length > 3){
                        perturbation_id_suggestion.innerText = `Values (${found_values.length}): ${mean(found_values).toExponential(2)} ± ${std(found_values).toExponential(2)}`;
                    }
                }
            }
        }
        if(found_values !== undefined && (typeof found_values[0] === "number")){
            perturbation_id_status.innerText = "✅"
            const range = 2
            const found_negative = found_values.some(x => x < 0)
            const found_positive = found_values.some(x => x > 0)
            if(found_positive && found_negative){
                perturbation_id_min.value = Math.min(...found_values) * range;
                perturbation_id_max.value = Math.max(...found_values) * range;
            }
            else{
                if(!found_negative && !found_positive){
                    perturbation_id_min.value = 0;
                    perturbation_id_max.value = 0;
                }
                else{
                    perturbation_id_min.value = found_positive ? Math.min(...found_values) / range : Math.min(...found_values) * range;
                    perturbation_id_max.value = found_positive ? Math.max(...found_values) * range : Math.max(...found_values) / range;
                }
            }
            perturbation_id_min.disabled = false
            perturbation_id_max.disabled = false
        }
        else{
            perturbation_id_status.innerText = "❌"
            perturbation_id_min.disabled = true
            perturbation_id_min.value = ""
            perturbation_id_max.disabled = true
            perturbation_id_max.value = ""
        }
    })
    perturbation_id_input.addEventListener("keydown", (e) => {
        const obj = {
            "state": JSON.parse(l2f.states[0].get_state()),
            "parameters": l2f.parameters[0]
        }
        if(e.key === "Enter"){
            const found_values = get_values_from_path(perturbation_id_input.value, obj)
            if(found_values !== undefined && (typeof found_values[0] === "number")){
                if(perturbation_groups.querySelectorAll(":scope > div").length == 0){
                    const new_perturbation_group = perturbation_group_template.content.cloneNode(true)
                    perturbation_groups.appendChild(new_perturbation_group)
                    const current_perturbation_group = perturbation_groups.querySelector(":scope > div:last-child")
                    const perturbation_slider = current_perturbation_group.querySelector(".perturbation-slider")
                    perturbation_slider.addEventListener("input", (e) => {
                        const current_perturbation_group_list = current_perturbation_group.querySelector(":scope > span.perturbation-group-list > ul")
                        const elements = Array.from(current_perturbation_group_list.querySelectorAll(":scope > li"))
                        const update_instructions = Object.fromEntries(elements.map((el, i) => {
                            // todo: batch this
                            const percent = parseFloat(perturbation_slider.value)
                            const original_value = el.original_values[i]
                            const new_value = percent > 0.5 ? (percent - 0.5) * 2 * (el.max - original_value) + original_value : (1 - (0.5 - percent) * 2) * (original_value - el.min) + el.min
                            let new_values = l2f.states.map((state, i) => new_value)
                            try{
                                new_values = l2f.states.map((state, i) => eval(el.transform)(i, original_value, percent, new_value));
                            }
                            catch(e){
                                console.error(e)
                            }
                            console.log("new value: ", new_values)

                            el.querySelector(".perturbation-group-item-value").textContent = `${mean(new_values).toExponential(1)} ± ${std(new_values).toExponential(1)}`;
                            return [el.path, new_values]
                        }))
                        if(elements.length > 1){
                            const perc_value = (perturbation_slider.value * 2 - 1) * 100
                            perturbation_slider_label.innerText = `${perc_value > 0 ? "+" : ""}${perc_value.toFixed(0)}%`
                        }
                        else{
                            const new_values = perturbation_slider_label.innerText = update_instructions[Object.keys(update_instructions)[0]]
                            if(new_values.every(x => x == new_values[0])){
                                perturbation_slider_label.innerText = `${new_values[0].toExponential(2)}`
                            }
                            else{
                                perturbation_slider_label.innerText = `${mean(new_values).toExponential(1)} ± ${std(new_values).toExponential(1)}`;
                            }
                        }
                        for(const [path, new_values] of Object.entries(update_instructions)){
                            set_values_at_path(path, new_values)
                        }
                    })
                    
                    const reset_button = perturbation_groups.querySelector(":scope > div:last-child button.perturbation-group-reset-button")
                    reset_button.addEventListener("click", () => {
                        const current_perturbation_group_list = current_perturbation_group.querySelector(":scope > span.perturbation-group-list > ul")
                        const elements = Array.from(current_perturbation_group_list.querySelectorAll(":scope > li"))
                        // elements.forEach((el, i) => {
                        //     perturbation_slider.value = 0.5
                        //     perturbation_slider.dispatchEvent(new Event("input"))
                        // })
                        const update_instructions = Object.fromEntries(elements.map((el, i) => {
                            el.querySelector(".perturbation-group-item-value").textContent = "reset";
                            return [el.path, el.original_values]
                        }))
                        for(const [path, new_values] of Object.entries(update_instructions)){
                            set_values_at_path(path, new_values)
                        }
                    })
                }
                const perturbation_group_nodes = perturbation_groups.querySelectorAll(":scope > div")
                const current_perturbation_group = perturbation_group_nodes[perturbation_group_nodes.length - 1]
                const perturbation_slider = current_perturbation_group.querySelector(":scope input.perturbation-slider")
                const perturbation_slider_label = current_perturbation_group.querySelector(":scope span.control-container-label")
                const current_perturbation_group_list = current_perturbation_group.querySelector(":scope > span.perturbation-group-list > ul")
                const elements = Array.from(current_perturbation_group_list.querySelectorAll(":scope > li"))
                const paths = elements.map(el => el.path)
                let el = null
                if(paths.includes(perturbation_id_input.value)){
                    el = elements.find(el => el.path === perturbation_id_input.value)
                    console.log("updating to: ", perturbation_id_min.value, perturbation_id_max.value)
                }
                else{
                    el = document.createElement("li")
                    const template = document.getElementById("perturbation-group-item-template");
                    el = template.content.firstElementChild.cloneNode(true);

                    el.path = perturbation_id_input.value
                    el.original_values = found_values
                    current_perturbation_group_list.appendChild(el)
                    el.style.cursor = "pointer"
                    el.addEventListener("click", () => {
                        current_perturbation_group_list.removeChild(el)
                        set_values_at_path(el.path, el.original_values)
                        if(current_perturbation_group_list.children.length === 0){
                            perturbation_groups.removeChild(current_perturbation_group)
                        }
                    })
                    perturbation_slider.disabled = false;
                    perturbation_slider.min = 0
                    perturbation_slider.max = 1
                    perturbation_slider.step = 0.05
                    perturbation_slider.value = 0.5
                }
                el.min = parseFloat(perturbation_id_min.value)
                el.max = parseFloat(perturbation_id_max.value)
                el.transform = perturbation_transform.value
                el.title = `Transform: ${el.transform}`
                el.querySelector(".perturbation-group-item-path").textContent = el.path;
                el.querySelector(".perturbation-group-item-range").textContent = `[${el.min.toExponential(2)}, ${el.max.toExponential(2)}]`;
                el.querySelector(".perturbation-group-item-value").textContent = el.original_values.reduce((acc, c) => acc + c/el.original_values.length, 0).toExponential(2);
            }
        }
    })
    perturbation_id_min.addEventListener("keydown", (e) => {
        if(e.key === "Enter"){
            const event = new Event('keydown')
            event.key = "Enter"
            perturbation_id_input.dispatchEvent(event)
        }
    })
    perturbation_id_max.addEventListener("keydown", (e) => {
        if(e.key === "Enter"){
            const event = new Event('keydown')
            event.key = "Enter"
            perturbation_id_input.dispatchEvent(event)
        }
    })
    perturbation_transform.addEventListener("keydown", (e) => {
        if(e.key === "Enter"){
            const event = new Event('keydown')
            event.key = "Enter"
            perturbation_id_input.dispatchEvent(event)
        }
    })

    l2f.initialized.then(() => {
        perturbation_id_input.value = "parameters.dynamics.mass"
        perturbation_id_input.dispatchEvent(new Event("input"))
        const event = new Event('keydown')
        event.key = "Enter"
        perturbation_id_input.dispatchEvent(event)
    })
}
window.onload = main

const drag_and_drop_overlay = document.getElementById('drag-and-drop-overlay');
let drag_and_drop_counter = 0;

['dragenter', 'dragover', 'dragleave', 'drop'].forEach(event => {
    document.body.addEventListener(event, e => {
        e.preventDefault();
        e.stopPropagation();
    }, false);
});

document.body.addEventListener('dragenter', () => {
    drag_and_drop_counter++;
    drag_and_drop_overlay.style.display = 'flex';
}, false);

document.body.addEventListener('dragleave', () => {
    drag_and_drop_counter--;
    if (drag_and_drop_counter === 0) {
        drag_and_drop_overlay.style.display = 'none';
    }
}, false);

document.body.addEventListener('drop', e => {
    drag_and_drop_counter = 0;
    drag_and_drop_overlay.style.display = 'none';
    
    const file = e.dataTransfer.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const array_buffer = e.target.result;
            model = rlt.load(array_buffer)
            console.log("loaded model: ", model)
        };
        reader.readAsArrayBuffer(file);
    }
}, false);