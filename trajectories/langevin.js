import { Trajectory } from "./base.js"

export class SecondOrderLangevin extends Trajectory {
    constructor() {
        super({
            // Damping
            gamma:  { range: [0, 5],  default: 1.0 },
            // Natural frequency
            omega:  { range: [0, 10], default: 2.0 },
            // Noise strength
            sigma:  { range: [0, 5],  default: 1.0 },
            // Periodicity
            T:      { range: [0, 20], default: 10.0 },
            // Time step
            dt:     { range: [0.001, 0.1], default: 0.01 },
            // EMA alpha
            alpha:  { range: [0, 1], default: 0.01 }
        })
        this.precompute()
    }

    set_parameter(key, value){
        super.set_parameter(key, value)
        this.precompute()
    }

    precompute() {
        const gamma = this.parameter_values.gamma
        const omega = this.parameter_values.omega
        const sigma = this.parameter_values.sigma
        const T     = this.parameter_values.T
        const dt    = this.parameter_values.dt
        const alpha = this.parameter_values.alpha

        this.N = Math.floor(T / dt) + 1

        this.t_array = new Array(this.N)
        this.X_array = new Array(this.N)
        this.V_array = new Array(this.N)
        this.A_array = new Array(this.N)
        const dW     = new Array(this.N)

        this.X_array[0] = 0.0
        this.V_array[0] = 0.0

        for (let i = 0; i < this.N; i++) {
            this.t_array[i] = i * dt
            dW[i] = randomGaussian() * Math.sqrt(dt)
        }

        for (let i = 1; i < this.N; i++) {
            const X_prev = this.X_array[i - 1]
            const V_prev = this.V_array[i - 1]
            this.V_array[i] = V_prev + (-gamma * V_prev - omega * omega * X_prev) * dt + sigma * dW[i]
            this.X_array[i] = X_prev + V_prev * dt
        }

        this.V_array = emaCausal(this.V_array, alpha)

        let cumulative = 0.0
        for (let i = 0; i < this.N; i++) {
            cumulative += this.V_array[i]
            this.X_array[i] = cumulative * dt
        }

        this.A_array[0] = this.V_array[0] / dt
        for (let i = 1; i < this.N; i++) {
            this.A_array[i] = (this.V_array[i] - this.V_array[i - 1]) / dt
        }
    }

    evaluate(t) {
        const dt = this.parameter_values.dt
        const T  = this.parameter_values.T
        const t_reflected = reflectTime(t, T)
        let i = Math.floor(t_reflected / dt)
        if (i < 0) i = 0
        if (i >= this.N) i = this.N - 1

        const x = this.X_array[i]
        const v = this.V_array[i]
        return [x, 0, 0, v, 0, 0]
    }
}

function randomGaussian() {
    let u1 = Math.random()
    let u2 = Math.random()
    let r  = Math.sqrt(-2.0 * Math.log(u1))
    let theta = 2.0 * Math.PI * u2
    return r * Math.cos(theta)
}
function emaCausal(x, alpha) {
    let y = new Array(x.length)
    if (x.length === 0) return y
    
    y[0] = x[0]
    for (let i = 1; i < x.length; i++) {
        y[i] = alpha * x[i] + (1.0 - alpha) * y[i - 1]
    }
    return y
}
function reflectTime(t, T) {
    const cycle = 2 * T
    let t_mod = ((t % cycle) + cycle) % cycle
    if (t_mod <= T) {
        return t_mod
    } else {
        return cycle - t_mod
    }
}
