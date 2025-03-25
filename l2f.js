// import * as ui from "./ui.js"
import createModule from "l2f-interface";
// const DEBUG = true
const DEBUG = false

import Stats from 'stats.js'

function mean(a){
    return a.reduce((sum, val) => sum + val, 0) / a.length
}
function std(x){
    const sample_mean = mean(x)
    const variance = x.reduce((sum, val) => sum + (val - sample_mean) ** 2, 0)
    return variance > 0 ?  Math.sqrt(variance / x.length) : 0;
}

export class L2F{
    constructor(parent, num_quadrotors, policy, seed){

        this.seed = seed


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
            this.canvas.style.width = parentRect.width + 'px';
            this.canvas.style.height = parentRect.height + 'px';
            this.canvas.width = parentRect.width * dpr;
            this.canvas.height = parentRect.height * dpr;
        };
        resizeCanvas()
        window.addEventListener('resize', resizeCanvas.bind(this), false);
        this.policy = policy

        this.initialized = createModule().then(async (l2f_interface) => {
            this.l2f_interface = l2f_interface
            this.states = [...Array(num_quadrotors)].map((_, i) =>new this.l2f_interface.State(this.seed + i));
            this.parameters = this.states.map(state => JSON.parse(state.get_parameters()))
            if(DEBUG){
                this.ui = ui
            }
            else{
                const blob = new Blob([this.states[0].get_ui()], { type: 'application/javascript' });
                const url = URL.createObjectURL(blob);
                this.ui = await import(url)
                URL.revokeObjectURL(url);
            }
            this.ui_state = await this.ui.init(this.canvas, {devicePixelRatio: window.devicePixelRatio})
            parent.appendChild(this.canvas);
            await this.ui.episode_init_multi(this.ui_state, this.parameters)

            this.render()
            this.real_time_factor = null
            this.control_timer = null
            this.control()
        });
        this.dt = null
    }
    async change_num_quadrotors(num){
        const diff = num - this.states.length
        if(diff > 0){
            const new_states = [...Array(num - this.states.length)].map((_, i) =>new this.l2f_interface.State(this.seed + this.states.length + i));
            this.states = this.states.concat(new_states)
        }
        else{
            this.states = this.states.slice(0, num)
        }
        this.parameters = this.states.map(state => JSON.parse(state.get_parameters()))
        this.update_render_state()
        await this.ui.episode_init_multi(this.ui_state, this.parameters)
        return diff
    }
    update_render_state(){
        this.render_states =  this.states.map(state => JSON.parse(state.get_state()))
        this.render_actions = this.states.map(state => JSON.parse(state.get_action()))

        
        const combined_state = this.render_states.map((state, i) => {
            return {
                "state": state,
                "action": this.render_actions[i],
                "parameters": this.parameters[i]
            }
        })
        this.state_update_callbacks.forEach(callback => callback(combined_state))
    }
    simulate_step(){
        let dts = []
        this.states.forEach(state => {
            const action = this.policy.evaluate_step(state)
            console.assert(action.length === state.action_dim, "Action dimension mismatch")
            action.map((v, i) => {
                state.set_action(i, v)
            })
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
        requestAnimationFrame(() => this.render());
        if(this.DEBUG){
            this.stats.end()
        }
    }
}
