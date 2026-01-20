// import * as ui from "./ui.js"
import createModule from "l2f-interface";
import * as THREE from "three"
import {Stats} from "stats.js"
// const DEBUG = true
const DEBUG = false

function mean(a){
    return a.reduce((sum, val) => sum + val, 0) / a.length
}
function std(x){
    const sample_mean = mean(x)
    const variance = x.reduce((sum, val) => sum + (val - sample_mean) ** 2, 0)
    return variance > 0 ?  Math.sqrt(variance / x.length) : 0;
}

export class L2F{
    constructor(parent, parameters, policy, seed){

        this.seed = seed
        this.request_pause = true


        this.state_update_callbacks = []

        const urlParams = new URLSearchParams(window.location.search);
        this.DEBUG = urlParams.has('DEBUG') ? urlParams.get('DEBUG') === 'true' : false


        if(this.DEBUG){
            this.stats = new Stats();
            this.stats.showPanel(0);

            this.stats.dom.style.transform = 'scale(3)';
            this.stats.dom.style.transformOrigin = 'top left';
            this.stats.dom.style.left = '0px';
            this.stats.dom.style.top = '0px';
            this.stats.dom.style.position = 'fixed';
            document.body.appendChild(this.stats.dom);
        }

        this.ticks = []
        this.control_tick = 0

        this.pause = false
        this.speed = 1
        this.canvas = document.createElement('canvas');
        if(DEBUG){
            this.canvas.style.backgroundColor = "white"
        }
        const dpr = window.devicePixelRatio || 1;
        const resizeCanvas = () => {
            const parentRect = parent.getBoundingClientRect();
            const newWidth = parentRect.width;
            const newHeight = parentRect.height;
            
            // Only update if dimensions actually changed
            if (this.canvas.style.width !== newWidth + 'px' || 
                this.canvas.style.height !== newHeight + 'px') {
                
                this.canvas.style.width = newWidth + 'px';
                this.canvas.style.height = newHeight + 'px';
                this.canvas.width = newWidth * dpr;
                this.canvas.height = newHeight * dpr;
            }
        };
        resizeCanvas();
        
        // Use ResizeObserver for better resize detection
        if ('ResizeObserver' in window) {
            this.resizeObserver = new ResizeObserver(entries => {
                resizeCanvas();
            });
            this.resizeObserver.observe(parent);
        } else {
            // Fallback for older browsers
            window.addEventListener('resize', resizeCanvas.bind(this), false);
        }
        this.policy = policy

        this.initialized = createModule().then(async (l2f_interface) => {
            this.l2f_interface = l2f_interface
            this.states = [...Array(parameters.length)].map((_, i) =>new this.l2f_interface.State(this.seed + i));
            this.parameters = structuredClone(parameters)
            this.states.forEach((state, i) => {
                state.set_parameters(JSON.stringify(this.parameters[i]))
            })
            this.perturbed_parameters = structuredClone(parameters)
            if(DEBUG){
                this.ui = ui
            }
            else{
                const blob = new Blob([this.states[0].get_ui()], { type: 'application/javascript' });
                const url = URL.createObjectURL(blob);
                this.ui = await import(url)
                URL.revokeObjectURL(url);
            }
            this.ui_state = await this.ui.init(this.canvas, {devicePixelRatio: window.devicePixelRatio, conta_url: "./conta/data/", camera_position: [1, 1, 2], camera_distance: 1.75})
            parent.appendChild(this.canvas);
            await this.ui.episode_init_multi(this.ui_state, this.parameters)

            this.render()
            this.real_time_factor = null
            this.control_timer = null
            this.control()
        });
        this.dt = null
        this.references = null
    }
    async change_num_quadrotors(num, parameters){
        const diff = num - this.states.length
        if(diff > 0){
            const new_states = [...Array(num - this.states.length)].map((_, i) =>new this.l2f_interface.State(this.seed + this.states.length + i));
            // new_states.forEach((state, i) => {
            //     state.set_parameters(JSON.stringify(parameters))
            // })
            this.states = this.states.concat(new_states)
            this.parameters = this.parameters.concat(new_states.map(_ => structuredClone(parameters)))
            this.perturbed_parameters = this.perturbed_parameters.concat(new_states.map(_ => structuredClone(parameters)))
        }
        else{
            this.states = this.states.slice(0, num)
            this.parameters = this.parameters.slice(0, num)
            this.perturbed_parameters = this.perturbed_parameters.slice(0, num)
        }
        this.update_render_state()
        await this.ui.episode_init_multi(this.ui_state, this.parameters)
        return diff
    }
    update_render_state(){
        this.render_states =  this.states.map(state => {return {
            "position": Array.from(state.get_position()),
            "orientation": Array.from(state.get_orientation())
        }})
        this.render_actions = this.states.map(state => Array.from(state.get_action()))

        
        const combined_state = this.render_states.map((state, i) => {
            return {
                "state": state,
                "action": this.render_actions[i],
                "parameters": this.perturbed_parameters[i]
            }
        })
        this.state_update_callbacks.forEach(callback => callback(combined_state))
    }
    remove_reference_markers(){
        if(this.references !== null){
            this.references_ui.forEach(ball => {
                this.ui_state.simulator.remove(ball)
            })
        }
        this.references_ui = []
        this.references = null
    }
    update_reference_markers(references){
        if(this.references === null || this.references.length !== references.length){
            // create three.js reference ball
            if(this.references !== null){
                this.remove_reference_markers()
            }
            this.references_ui = references.map((reference, i) => {
                const geometry = new THREE.SphereGeometry(Math.cbrt(this.parameters[i].dynamics.mass) / 50, 32, 32);
                const material = new THREE.MeshStandardMaterial({ color: 0xff4444 });
                const ball = new THREE.Mesh(geometry, material);
                const reference_ui_objects = this.ui_state.simulator.add(ball)
                return ball
            })
        }
        this.references = references
    }
    simulate_step(){
        const actions = this.policy.evaluate_step(this.states)
        const references = this.policy.get_reference(this.states)
        if(references !== null){
            this.update_reference_markers(references)
            this.references.forEach((reference, i) => {
                const reference_index = this.policy.get_reference_index(reference, 0)
                this.references_ui[i].position.set(reference[reference_index][0], reference[reference_index][1], reference[reference_index][2])
            })
        }
        console.assert(actions.length === this.states.length, "Action dimension mismatch")
        this.states.forEach((state, i) => {
            const action = actions[i]
            console.assert(action.length === state.action_dim, "Action dimension mismatch")
            action.map((v, i) => {
                state.set_action(i, v)
            })
        })
        let dts = []
        this.states.forEach((state, i) => {
            const dt = state.step()
            dts.push(dt)
        })
        this.update_render_state()
        if(this.DEBUG){
            console.assert(!dts.some(dt => dt !== dts[0]), "dt mismatch")
        }
        return dts[0]
    }

    async control(){
        const now = performance.now()
        if(!this.pause){
            this.ticks.push(now)
            const real_time_factor_interval = Math.floor(100 * this.current_speed)
            this.ticks = this.ticks.slice(-real_time_factor_interval)
            if(this.control_tick % real_time_factor_interval === 0){
                if(this.dt !== null && this.ticks.length === real_time_factor_interval){
                    this.real_time_factor = this.dt / (mean(this.ticks.slice(1).map((tick, i) => tick - this.ticks[i])) / 1000)
                }
            }
            const dt = this.simulate_step()
            if(this.DEBUG && this.dt !== null && this.dt !== dt){
                console.error(`dt mismatch: ${this.dt} != ${dt}`)
            }
            this.dt = dt
            if(this.control_timer === null || this.speed !== this.current_speed){
                this.current_speed = this.speed
                if(this.control_timer !== null){
                    clearInterval(this.control_timer)
                }
                this.control_timer = setInterval(this.control.bind(this), this.dt / this.speed * 1000)
            }
            if(this.request_pause){
                this.pause = true
                this.request_pause = false
            }
            this.control_tick += 1
        }
        if(this.request_unpause){
            this.pause = false
            this.request_unpause = false
            this.last_step = performance.now()
            this.ticks = []
        }
    }
    async render(){
        if(this.DEBUG){
            this.stats.begin()
        }
        if(this.render_states && this.render_actions){
            this.ui.render_multi(this.ui_state, this.parameters, this.render_states, this.render_actions)
        }
        this.ui_state
        requestAnimationFrame(() => this.render());
        if(this.DEBUG){
            this.stats.end()
        }
    }
    async set_parameters(ids, parameters){
        await this.initialized
        ids.forEach((id, i) => {
            const previous_parameters = this.parameters[id]
            this.parameters[id] = structuredClone(parameters[i])
            this.perturbed_parameters[id] = structuredClone(parameters[i])
            this.states[id].set_parameters(JSON.stringify(parameters[i]))
            // the new parameters define the RPM range (all other state variables are natural and have the same scaling)
            const previous_min_rpm = previous_parameters.dynamics.action_limit.min
            const previous_max_rpm = previous_parameters.dynamics.action_limit.max
            const min_rpm = parameters[i].dynamics.action_limit.min
            const max_rpm = parameters[i].dynamics.action_limit.max
            const state = JSON.parse(this.states[id].get_state())
            state["rpm"].forEach((rpm, j) => {
                const new_rpm = previous_min_rpm + (rpm - previous_min_rpm) * (max_rpm - min_rpm) / (previous_max_rpm - previous_min_rpm)
                state["rpm"][j] = Math.max(Math.min(new_rpm, max_rpm), min_rpm)
            })
            this.states[id].set_state(JSON.stringify(state))
        })
        await this.ui.episode_init_multi(this.ui_state, this.parameters)
        this.remove_reference_markers()
    }
    async set_perturbed_parameters(ids, parameters){
        await this.initialized
        ids.forEach((id, i) => {
            this.perturbed_parameters[id] = structuredClone(parameters[i])
            this.states[id].set_parameters(JSON.stringify(parameters[i]))
        })
    }

}
