import { L2F } from "./l2f.js"
import { SimControls } from "./sim_controls.js";
import { ParameterManager } from "./parameter_manager.js";
import * as rlt from "rltools"
import * as math from "mathjs"
import { Gamepad } from "./gamepad.js"
import { GamepadController } from "./gamepad_controller.js"
import { Position } from "./trajectories/position.js"
import { Lissajous } from "./trajectories/lissajous.js"
import { SecondOrderLangevin } from "./trajectories/langevin.js"
import { PingPong } from "./trajectories/ping_pong.js"
// import Controller from  "./controller.js"

// check url for "file" parameter
const urlParams = new URLSearchParams(window.location.search);
const file = urlParams.get('file');
const file_url = file ? file : "./blob/checkpoint.h5"

let proxy_controller = null

async function sleep(ms){
    return new Promise(resolve => setTimeout(resolve, ms));
}


class ProxyController {
    constructor(current_policy) {
        this.policy = current_policy
    }
    evaluate_step(state) {
        return this.policy.evaluate_step(state)
    }
    reset() {
        this.policy.reset()
    }
    get_reference(states){
        return this.policy.get_reference(states)
    }
    get_reference_index(trajectory, offset){
        return this.policy.get_reference_index(trajectory, offset)
    }
}
class MultiController {
    constructor(Controller) {
        this.Controller = Controller
        this.controllers = null
    }
    evaluate_step(state) {
        if (this.controllers === null || this.controllers.length !== state.length) {
            this.controllers = state.map(() => new this.Controller())
        }
        return state.map((state, i) => this.controllers[i].evaluate_step(state))
    }
    reset() {
        if (this.controllers === null) {
            return
        }
        this.controllers.forEach(controller => controller.reset())
    }
    get_reference(states){
        // console.assert(this.controllers.length == states.length)
        // return this.controllers.map((c) => c.get_reference())
        return null
    }
}

let model = null
let trajectory = null
let trajectory_offset = 0
let trajectory_offset_axis = 0
class Policy{
    constructor() {
        this.step = 0
        this.policy_states = null
    }
    get_observation(state, obs, trajectory) {
        let vehicle_state = null
        const full_observation = Array.from(state.get_observation())
        console.assert(full_observation.length > 18, "Observation is smaller than base observation")
        const get_state = () => {
            if (vehicle_state === null) {
                vehicle_state = JSON.parse(state.get_state())
            }
            return vehicle_state
        }
        switch (true) {
            case obs === "Position" || obs === "TrajectoryTrackingPosition":
                return full_observation.slice(0, 3)
            case obs === "OrientationRotationMatrix":
                return full_observation.slice(3, 12)
            case obs === "LinearVelocity" || obs === "TrajectoryTrackingLinearVelocity":
                return full_observation.slice(12, 15)
            case obs.startsWith("LinearVelocityDelayed"):{
                const delay_string = obs.split("(")[1].split(")")[0]
                const delay = parseInt(delay_string)
                if (delay === 0) {
                    return full_observation.slice(12, 15)
                } else {
                    const s = get_state(0)
                    return s["linear_velocity_history"][s["linear_velocity_history"].length - delay]
                }
            }
            case obs.startsWith("TrajectoryTrackingLookahead"):
                const parameters_string = obs.split("(")[1].split(")")[0]
                const parameters_split = parameters_string.split(",")
                const num_steps = parseInt(parameters_split[0])
                const step_interval = parseInt(parameters_split[1])
                const current_position = full_observation.slice(0, 3)
                const current_velocity = full_observation.slice(12, 15)
                const flat_observation = new Array(num_steps).fill(0).map((_, step_i) => {
                    const clip = (x, min, max) => x  < min ? min : (x > max ? max : x);
                    const position_clip = x => clip(x, -1, 1)
                    const velocity_clip = x => clip(x, -2, 2)
                    const reference_index = this.get_reference_index(trajectory, step_i * step_interval)
                    return [...current_position.map((x, axis_i) => {
                        return position_clip(x - trajectory[reference_index][axis_i])
                    }), ...current_velocity.map((x, axis_i) => {
                        return velocity_clip(x - trajectory[reference_index][3+axis_i])
                    })]
                }).flat()
                return flat_observation
            case obs === "AngularVelocity":
                return full_observation.slice(15, 18)
            case obs.startsWith("AngularVelocityDelayed"):{
                const delay_string = obs.split("(")[1].split(")")[0]
                const delay = parseInt(delay_string)
                if (delay === 0) {
                    return full_observation.slice(15, 18)
                } else {
                    const s = get_state(0)
                    return s["angular_velocity_history"][s["angular_velocity_history"].length - delay]
                }
            }
            case obs.startsWith("ActionHistory"):
                const history_length_string = obs.split("(")[1].split(")")[0]
                const history_length = parseInt(history_length_string)
                return full_observation.slice(18, 18 + history_length * 4)
            case obs === "RotorSpeeds":
                const parameters = JSON.parse(state.get_parameters())
                const min_action = parameters.dynamics.action_limit.min
                const max_action = parameters.dynamics.action_limit.max
                return get_state()["rpm"].map(x => (x - min_action) / (max_action - min_action) * 2 - 1)
            default:
                console.error("Unknown observation: ", obs)
                return null
        }
    }
    evaluate_step(states) {
        if (!this.policy_states || this.policy_states.length !== states.length) {
            this.policy_states = states.map(() => null)
        }
        this.step += 1
        const references = this.get_reference(states)
        return states.map((state, i) => {
            state.observe()
            const reference = references[i]
            const observation_description = document.getElementById("observations").observation
            let input = math.matrix([observation_description.split(".").map(x => this.get_observation(state, x, reference)).flat()])
            const [output, new_state] = model.evaluate_step(input, this.policy_states[i])
            this.policy_states[i] = new_state
            return output.valueOf()[0]
        })
    }
    reset() {
        this.step = 0
        this.policy_states = null
    }
    _get_reference(){
        return trajectory.trajectory
    }
    get_reference(states){
        const ref = this._get_reference()
        return states.map((_, i) => {
            return ref.map((step, j) => {
                const step_copy = step.slice()
                step_copy[trajectory_offset_axis] += trajectory_offset * i
                return step_copy
            })
        })
    }
    get_reference_index(reference, offset){
        const real_step = this.step + offset
        const offset_interval = Math.floor(real_step / reference.length)
        const offset_index = real_step % reference.length
        const forward = offset_interval % 2 === 0
        return forward ? offset_index : reference.length - offset_index - 1
    }
}


function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary); // Base64 encode the binary string
}

function base64ToArrayBuffer(base64) {
    const binary = atob(base64); // Decode Base64 to binary string
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer; // Return the ArrayBuffer
}

function showStatus(message, isError = false) {
    const status = document.getElementById('status');
    status.textContent = message;
    status.style.display = 'block';
    status.className = `status ${isError ? 'error' : 'success'}`;
    setTimeout(() => status.style.display = 'none', 3000);
}

async function load_model(checkpoint) {
    if (typeof checkpoint === "string") {
        checkpoint = await (await fetch(checkpoint)).arrayBuffer()
    }
    localStorage.setItem("checkpoint", arrayBufferToBase64(checkpoint))
    model = await rlt.load(checkpoint)
    const checkpoint_span = document.getElementById("checkpoint-name")
    checkpoint_span.textContent = model.checkpoint_name
    checkpoint_span.title = model.description()
    document.getElementById("observations").value = model.meta.environment.observation
    document.getElementById("observations").observation = model.meta.environment.observation
    proxy_controller.reset()
}

async function main() {
    const trajectory_offset_container = document.getElementById("reference-trajectory-offset-container")
    const trajectory_offset_slider = trajectory_offset_container.querySelector("input[type=range]")
    const trajectory_offset_label = trajectory_offset_container.querySelectorAll(".control-container-label")[0]
    trajectory_offset_label.addEventListener("click", (event) => {
        switch(trajectory_offset_label.textContent){
            case "":
                trajectory_offset_label.textContent = "X Offset"
                trajectory_offset_axis = 0
                break;
            case "X Offset":
                trajectory_offset_label.textContent = "Y Offset"
                trajectory_offset_axis = 1
                break;
            case "Y Offset":
                trajectory_offset_label.textContent = "Z Offset"
                trajectory_offset_axis = 2
                break;
            case "Z Offset":
                trajectory_offset_label.textContent = "X Offset"
                trajectory_offset_axis = 0
                break;
        }
    })
    trajectory_offset_label.dispatchEvent(new Event("click"))
    const trajectory_offset_value = trajectory_offset_container.querySelectorAll(".control-container-label")[1]
    trajectory_offset_slider.addEventListener("input", (event) => {
        trajectory_offset = parseFloat(event.target.value)
        trajectory_offset_value.textContent = trajectory_offset.toFixed(2)
    })
    const trajectory_select = document.getElementById("reference-trajectory")
    const trajectories = { "Position": Position, "Lissajous": Lissajous, "Langevin": SecondOrderLangevin, "Ping Pong": PingPong }
    trajectory_select.innerHTML = ""
    for (const name in trajectories) {
        trajectory_select.innerHTML += `<option value="${name}">${name}</option>`
    }
    trajectory_select.addEventListener("change", (event) => {
        const trajectory_class = trajectories[event.target.value]
        trajectory = new trajectory_class()


        const trajectory_options_container = document.getElementById("reference-trajectory-options")
        trajectory_options_container.innerHTML = ""
        const trajectory_option_template = document.getElementById("reference-trajectory-option-template")

        for (const [key, config] of Object.entries(trajectory.parameters)) {
            const template = trajectory_option_template.content.cloneNode(true)

            const labels = template.querySelectorAll(".control-container-label")
            labels[0].textContent = key
            labels[1].textContent = config.default

            const slider = template.querySelector("input[type=range]")
            slider.min = config.range[0]
            slider.max = config.range[1]
            slider.step = 0.01
            slider.value = config.default

            slider.addEventListener("input", () => {
                labels[1].textContent = slider.value
                trajectory.set_parameter(key, parseFloat(slider.value))
                trajectory.parameters_updated()
            })

            trajectory_options_container.appendChild(template)
        }
    })
    document.getElementById("reference-trajectory-reset").addEventListener("click", () => {
        trajectory_select.dispatchEvent(new Event("change"))
    })
    document.getElementById("reference-trajectory-reset").dispatchEvent(new Event("click"))


    document.getElementById("default-checkpoint-btn").addEventListener("click", async () => {
        load_model(file_url)
    })
    document.getElementById("load-checkpoint-btn").addEventListener("click", async () => {
        document.getElementById("load-checkpoint-btn-backend").click();
    })
    document.getElementById("load-checkpoint-btn-backend").addEventListener("change", async (event) => {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = async function (e) {
                const array_buffer = e.target.result;
                load_model(array_buffer)
                console.log("loaded model: ", model.checkpoint_name)
                showStatus(`Loaded model: ${model.checkpoint_name}`);
            };
            reader.readAsArrayBuffer(file);
        }
        event.target.value = "";
    })
    document.getElementById("observations").addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            document.getElementById("observations").observation = document.getElementById("observations").value
        }
    })
    const controller_code_loaded = fetch("./controller.js").then(async (response) => {
        if (response.status !== 200) {
            console.error("Error loading controller.js: ", response.status)
        }
        document.getElementById("controller-code").value = await response.text()
        document.getElementById("controller-selector-container").querySelectorAll('input[name="choice"]').forEach(radio => {
            radio.addEventListener("change", (event) => {
                if (event.target.value === "policy") {
                    document.getElementById("policy-container").style.display = "block"
                    document.getElementById("controller-container").style.display = "none"
                    document.getElementById("gamepad-container").style.display = "none"
                    proxy_controller.policy = new Policy(model)
                }
                else if (event.target.value === "controller") {
                    document.getElementById("policy-container").style.display = "none"
                    document.getElementById("controller-container").style.display = "block"
                    document.getElementById("gamepad-container").style.display = "none"
                    const event = new KeyboardEvent("keydown", { key: "Enter" });
                    document.getElementById("controller-code").dispatchEvent(event);
                }
                else if (event.target.value === "gamepad") {
                    document.getElementById("policy-container").style.display = "none"
                    document.getElementById("controller-container").style.display = "none"
                    document.getElementById("gamepad-container").style.display = "block"
                    const parent = document.getElementById("gamepad-container")
                    const gamepad = new Gamepad(parent, {
                        "thrust": {
                            type: "axis",
                            positive_direction: "Up"
                        },
                        "roll": {
                            type: "axis",
                            positive_direction: "Right"
                        },
                        "pitch": {
                            type: "axis",
                            positive_direction: "Forward"
                        },
                        "yaw": {
                            type: "axis",
                            positive_direction: "Clockwise"
                        },
                        "reset": {
                            type: "button"
                        },
                    })
                    proxy_controller.policy = new GamepadController(gamepad)
                    gamepad.addListener((output) => {
                        if (output["reset"] === true) {
                            const button = document.getElementById("initial-states")
                            button.dispatchEvent(new Event('click'));
                        }
                    })
                }
            });
        });
        // const gamepadRadio = document.querySelector('input[name="choice"][value="gamepad"]');
        // gamepadRadio.checked = true;
        // gamepadRadio.dispatchEvent(new Event('change'));
    })
    document.getElementById("controller-code").addEventListener("keydown", async (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            const code = document.getElementById("controller-code").value
            const blob = new Blob([code], { type: 'application/javascript' });
            const url = URL.createObjectURL(blob);
            const Controller = (await import(url)).default
            URL.revokeObjectURL(url);
            proxy_controller.policy = new MultiController(Controller)
            window.controller = proxy_controller.policy
        }
    })

    document.getElementById("vehicle-select-all-btn").addEventListener("click", () => {
        const vehicle_container = document.getElementById("vehicle-list")
        const elements = Array.from(vehicle_container.querySelectorAll(":scope .vehicle"))
        const checkboxes = elements.map(vehicle => vehicle.querySelector(".vehicle-checkbox"))
        let all_checked = checkboxes.every(checkbox => checkbox.checked)
        checkboxes.forEach(checkbox => {
            checkbox.checked = !all_checked
        })
    })


    const seed = 12

    let checkpoint = null
    if (localStorage.getItem("checkpoint") !== null) {
        console.log("loading checkpoint from local storage")
        checkpoint = base64ToArrayBuffer(localStorage.getItem("checkpoint"))
    }
    else {
        console.log(`Loading checkpoint from ${file_url}`)
        checkpoint = await (await fetch(file_url)).arrayBuffer()
        localStorage.setItem("checkpoint", arrayBufferToBase64(checkpoint))
    }
    load_model(checkpoint)

    const sim_container = document.getElementById("sim-container")
    proxy_controller = new ProxyController(new Policy(model))


    const platforms_text = await (await fetch("./blob/registry/index.json")).text()
    const platforms = platforms_text.split("\n").filter(line => line.trim() !== "").sort()
    const platform_select = document.getElementById("vehicle-load-dynamics-selector")
    platforms.forEach(platform => {
        platform_select.innerHTML += `<option value="${platform}">${platform}</option>`
    })

    const param_override = urlParams.get('parameters');
    platform_select.value = param_override ? param_override : "x500";

    const default_parameters = await (await fetch(`./blob/registry/${platform_select.value}.json`)).json()

    console.log("Waiting for trajectory to be initialized")

    const l2f = new L2F(sim_container, Array(10).fill(default_parameters), proxy_controller, seed)

    l2f.state_update_callbacks.push((states) => {
        const vehicle_container = document.getElementById("vehicle-list")
        if (vehicle_container.children.length != states.length) {
            const vehicle_template = document.getElementById("vehicle-template")
            vehicle_container.innerHTML = ""
            states.forEach((state, i) => {
                const vehicle_pre = vehicle_template.content.cloneNode(true)
                const vehicle = vehicle_pre.querySelector(".vehicle")
                vehicle.dataset.vehicleId = i
                vehicle.querySelector(".vehicle-title").textContent = `Vehicle ${i}`
                // vehicle.querySelector(".vehicle-id").textContent = JSON.stringify(state.parameters.dynamics, null, 2)
                vehicle_container.appendChild(vehicle)
                // on hover
                vehicle.addEventListener("mouseenter", (event) => {
                    console.log(`hovering over vehicle ${i}`)
                    vehicle.classList.add("vehicle-hover")
                    event.stopPropagation()
                })
                vehicle.addEventListener("mouseleave", (event) => {
                    vehicle.classList.remove("vehicle-hover")
                    event.stopPropagation()
                })
            })
        }
        states.forEach((state, i) => {
            const vehicle = vehicle_container.children[i]
            const fixed = (x, n) => {
                const y = x.toFixed(n);
                return y >= 0 ? `+${y}` : y;
            }
            vehicle.querySelector(".vehicle-position").textContent = state.state.position.map(x => fixed(x, 3)).join(",")
            vehicle.querySelector(".vehicle-action").textContent = state.action.map(x => fixed(x, 2)).join(",")
            const thrusts = state.parameters.dynamics.rotor_thrust_coefficients.map(curve => curve.reduce((a, c, i) => a + c * Math.pow(state.parameters.dynamics.action_limit.max, i), 0))
            const t2w = thrusts.reduce((a, c) => a+c, 0)/(9.81 * state.parameters.dynamics.mass)
            const torque = Math.abs(state.parameters.dynamics.rotor_positions[0][0]) * Math.sqrt(2) * thrusts[0]
            const t2i = torque / state.parameters.dynamics.J[0][0]
            vehicle.querySelector(".vehicle-t2w-t2i").textContent = `${t2w.toFixed(2)} / ${t2i.toFixed(2)}`
            vehicle.title = JSON.stringify(state.parameters.dynamics, null, 2)
        })

    })

    l2f.initialized.then(async () => {
        await parameter_manager.initialized
        const sim_container_cover = document.getElementById("sim-container-cover")
        sim_container_cover.style.display = "none"
        const pause_button = document.getElementById("pause")
        if(pause_button.innerText === "Resume"){
            pause_button.click()
        }

        const perturbation_id_input = document.getElementById("perturbation-id-input")
        perturbation_id_input.value = "parameters.dynamics.mass"
        perturbation_id_input.dispatchEvent(new Event("input"))
        const event = new Event('keydown')
        event.key = "Enter"
        perturbation_id_input.dispatchEvent(event)
    })

    

    const parameter_manager = new ParameterManager(l2f)
    const sim_controls = new SimControls(l2f, proxy_controller)


    const set_parameters = async (parameters) => {
        const vehicle_container = document.getElementById("vehicle-list")
        const elements = Array.from(vehicle_container.querySelectorAll(":scope .vehicle"))
        let ids = []
        elements.forEach(vehicle => {
            const checkbox = vehicle.querySelector(".vehicle-checkbox")
            if (checkbox && checkbox.checked) {
                const vehicleId = parseInt(vehicle.dataset.vehicleId, 10)
                ids.push(vehicleId)
            }
        })
        // If no checkboxes are checked, update all vehicles
        if (ids.length === 0) {
            ids = elements.map(vehicle => parseInt(vehicle.dataset.vehicleId, 10))
        }
        console.log("setting parameters for vehicles: ", ids)
        console.log("parameters: ", parameters)
        await l2f.set_parameters(ids, ids.map(() => parameters))
    }
    document.getElementById("vehicle-load-dynamics-btn-backend").addEventListener("change", async (event) => {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = async function (e) {
                console.log(`Loaded dynamics from ${file.name}`)
                const parameters = JSON.parse(e.target.result)
                set_parameters(parameters)
            };
            reader.readAsText(file);
        }
        event.target.value = "";
    })
    document.getElementById("vehicle-load-dynamics-btn").addEventListener("click", async () => {
        if (document.getElementById("vehicle-load-dynamics-selector").value === "file") {
            document.getElementById("vehicle-load-dynamics-btn-backend").click();
            return;
        }
        else{
            const platform = document.getElementById("vehicle-load-dynamics-selector").value
            const parameters = await (await fetch(`./blob/registry/${platform}.json`)).json()
            set_parameters(parameters)
        }
    })


}

if (document.readyState === 'loading') {
    document.addEventListener("DOMContentLoaded", main)
} else {
    main()
}

function setupScrollIndicatorHiding() {
    const scrollIndicator = document.getElementById('scroll-indicator');
    const controlsBox = document.getElementById('controls-box');
    if (scrollIndicator && controlsBox) {
        function checkOverflowAndUpdateIndicator() {
            const hasOverflow = controlsBox.scrollHeight > controlsBox.clientHeight;
            if (hasOverflow) {
                const isAtBottom = controlsBox.scrollTop + controlsBox.clientHeight >= controlsBox.scrollHeight - 1;
                if (isAtBottom) {
                    scrollIndicator.style.display = 'none';
                } else {
                    scrollIndicator.style.display = 'flex';
                    scrollIndicator.classList.remove('hidden');
                }
            } else {
                scrollIndicator.style.display = 'none';
            }
        }
        
        checkOverflowAndUpdateIndicator();
        
        controlsBox.addEventListener('scroll', checkOverflowAndUpdateIndicator);
        
        const resizeObserver = new ResizeObserver(checkOverflowAndUpdateIndicator);
        resizeObserver.observe(controlsBox);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener("DOMContentLoaded", setupScrollIndicatorHiding);
} else {
    setupScrollIndicatorHiding();
}

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
        reader.onload = async function (e) {
            const array_buffer = e.target.result;
            localStorage.setItem("checkpoint", arrayBufferToBase64(array_buffer))
            load_model(array_buffer)
            console.log("loaded model: ", model.checkpoint_name)
            showStatus(`Loaded model: ${model.checkpoint_name}`);
        };
        reader.readAsArrayBuffer(file);
    }
}, false);

