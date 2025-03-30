import {L2F} from "./l2f.js"
import { SimControls } from "./sim_controls.js";
import { ParameterManager } from "./parameter_manager.js";
import * as rlt from "rltools"
import * as math from "mathjs"

// import Controller from  "./controller.js"

// check url for "file" parameter
const urlParams = new URLSearchParams(window.location.search);
const file = urlParams.get('file');
const file_url = file ? file : "./blob/checkpoint.h5"

let proxy_controller = null

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

class ProxyController{
    constructor(current_policy){
        this.policy = current_policy
    }
    evaluate_step(state){
        return this.policy.evaluate_step(state)
    }
    reset(){
        this.policy.reset()
    }
}
class MultiController{
    constructor(Controller){
        this.Controller = Controller
        this.controllers = null
    }
    evaluate_step(state){
        if(this.controllers === null || this.controllers.length !== state.length){
            this.controllers = state.map(() => new this.Controller())
        }
        return state.map((state, i) => this.controllers[i].evaluate_step(state))
    }
    reset(){
        if(this.controllers === null){
            return
        }
        this.controllers.forEach(controller => controller.reset())
    }
}

let model = null
class Policy{
    constructor(){
        this.step = 0
        this.states = null
    }
    get_observation(state, obs){
        let vehicle_state = null
        const full_observation = [...Array(state.observation_dim).keys()].map(i => state.get_observation(i))
        console.assert(full_observation.length > 18, "Observation is smaller than base observation")
        const get_state = () => {
            if (vehicle_state === null) {
                vehicle_state = JSON.parse(state.get_state())
            }
            return vehicle_state
        }
        switch (true) {
            case obs === "Position":
                return full_observation.slice(0, 3)
            case obs === "OrientationRotationMatrix":
                return full_observation.slice(3, 12)
            case obs === "LinearVelocity":
                return full_observation.slice(12, 15)
            case obs === "AngularVelocity":
                return full_observation.slice(15, 18)
            case obs.startsWith("AngularVelocityDelayed"):
                const delay_string = obs.split("(")[1].split(")")[0]
                const delay = parseInt(delay_string)
                if (delay === 0) {
                    return full_observation.slice(15, 18)
                } else {
                    const s = get_state()
                    return s["angular_velocity_history"][s["angular_velocity_history"].length - delay]
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
        if(!this.states || this.states.length !== states.length){
            this.states = states.map(() => null)
        }
        return states.map((state, i) => {
            state.observe()
            const observation_description = document.getElementById("observations").observation
            let input = math.matrix([observation_description.split(".").map(x => this.get_observation(state, x)).flat()])
            const input_offset = default_trajectory(this.step / 100)
            input_offset.forEach((x, i) => {
                input._data[0][i] = input._data[0][i] - x
            })
            const [output, new_state] = model.evaluate_step(input, this.states[i])
            this.states[i] = new_state
            this.step += 1
            return output.valueOf()[0]
        })
    }
    reset() {
        this.step = 0
        this.states = null
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

async function load_model(checkpoint){
    if(typeof checkpoint === "string"){
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

async function main(){
    document.getElementById("default-checkpoint-btn").addEventListener("click", async () => {
        load_model(file_url)
    })
    document.getElementById("load-checkpoint-btn").addEventListener("click", async () => {
        document.getElementById("load-checkpoint-btn-backend").click();
    })
    document.getElementById("load-checkpoint-btn-backend").addEventListener("change", async () => {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = async function(e) {
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
            document.getElementById("observations").observation  = document.getElementById("observations").value
        }
    })
    const controller_code_loaded = fetch("./controller.js").then(async (response) => {
        if(response.status !== 200){
            console.error("Error loading controller.js: ", response.status)
        }
        document.getElementById("controller-code").value = await response.text()
        document.getElementById("controller-selector-container").querySelectorAll('input[name="choice"]').forEach(radio => {
            radio.addEventListener("change", (event) => {
                if(event.target.value === "policy"){
                    document.getElementById("policy-container").style.display = "block"
                    document.getElementById("controller-container").style.display = "none"
                    proxy_controller.policy = new Policy(model)
                }
                else{
                    document.getElementById("policy-container").style.display = "none"
                    document.getElementById("controller-container").style.display = "block"
                    const event = new KeyboardEvent("keydown", {key: "Enter"});
                    document.getElementById("controller-code").dispatchEvent(event);
                }
            });
        });
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
    document.getElementById("vehicle-load-dynamics-btn").addEventListener("click", async () => {
        document.getElementById("vehicle-load-dynamics-btn-backend").click();
    })


    const seed = 12

    let checkpoint = null
    if(localStorage.getItem("checkpoint") !== null){
        console.log("loading checkpoint from local storage")
        checkpoint = base64ToArrayBuffer(localStorage.getItem("checkpoint"))
    }
    else{
        console.log(`Loading checkpoint from ${file_url}`)
        checkpoint = await (await fetch(file_url)).arrayBuffer()
        localStorage.setItem("checkpoint", arrayBufferToBase64(checkpoint))
    }
    load_model(checkpoint)

    const sim_container = document.getElementById("sim-container")
    proxy_controller = new ProxyController(new Policy(model))
    const l2f = new L2F(sim_container, 10, proxy_controller, seed)

    l2f.state_update_callbacks.push((states) => {
        const vehicle_container = document.getElementById("vehicle-list")
        if(vehicle_container.children.length != states.length){
            const vehicle_template = document.getElementById("vehicle-template")
            vehicle_container.innerHTML = ""
            states.forEach((state, i) => {
                const vehicle_pre = vehicle_template.content.cloneNode(true)
                const vehicle = vehicle_pre.querySelector(".vehicle")
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
            vehicle.title = JSON.stringify(state.parameters.dynamics, null, 2)
        })

    })

    const parameter_manager = new ParameterManager(l2f)
    const sim_controls = new SimControls(l2f, proxy_controller, parameter_manager)

    document.getElementById("vehicle-load-dynamics-btn-backend").addEventListener("change", async () => {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = async function(e) {
                console.log(`Loaded dynamics from ${file.name}`)
                const parameters = JSON.parse(e.target.result)
                const dynamics = parameters.dynamics
                const vehicle_container = document.getElementById("vehicle-list")
                const elements = Array.from(vehicle_container.querySelectorAll(":scope .vehicle"))
                const checkboxes = elements.map(vehicle => vehicle.querySelector(".vehicle-checkbox"))
                const ids = []
                checkboxes.forEach((checkbox, i) => {
                    if(checkbox.checked){
                        ids.push(i)
                    }
                })
                parameter_manager.set_dynamics(ids, ids.map(() => dynamics))
            };
            reader.readAsText(file);
        }
    })
}

document.addEventListener("DOMContentLoaded", main)

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
        reader.onload = async function(e) {
            const array_buffer = e.target.result;
            localStorage.setItem("checkpoint", arrayBufferToBase64(array_buffer))
            load_model(array_buffer)
            console.log("loaded model: ", model.checkpoint_name)
            showStatus(`Loaded model: ${model.checkpoint_name}`);
        };
        reader.readAsArrayBuffer(file);
    }
}, false);

