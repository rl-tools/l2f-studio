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
        this.Y_array = new Array(this.N)
        this.Z_array = new Array(this.N)
        this.Vx_array = new Array(this.N)
        this.Vy_array = new Array(this.N)
        this.Vz_array = new Array(this.N)
        this.Ax_array = new Array(this.N)
        this.Ay_array = new Array(this.N)
        this.Az_array = new Array(this.N)
        const dWx = new Array(this.N)
        const dWy = new Array(this.N)
        const dWz = new Array(this.N)

        this.X_array[0] = 0
        this.Y_array[0] = 0
        this.Z_array[0] = 0
        this.Vx_array[0] = 0
        this.Vy_array[0] = 0
        this.Vz_array[0] = 0

        for (let i = 0; i < this.N; i++) {
            this.t_array[i] = i * dt
            dWx[i] = randomGaussian() * Math.sqrt(dt)
            dWy[i] = randomGaussian() * Math.sqrt(dt)
            dWz[i] = randomGaussian() * Math.sqrt(dt)
        }

        for (let i = 1; i < this.N; i++) {
            const Xp = this.X_array[i - 1]
            const Yp = this.Y_array[i - 1]
            const Zp = this.Z_array[i - 1]
            const Vxp = this.Vx_array[i - 1]
            const Vyp = this.Vy_array[i - 1]
            const Vzp = this.Vz_array[i - 1]
            this.Vx_array[i] = Vxp + (-gamma * Vxp - omega * omega * Xp) * dt + sigma * dWx[i]
            this.Vy_array[i] = Vyp + (-gamma * Vyp - omega * omega * Yp) * dt + sigma * dWy[i]
            this.Vz_array[i] = Vzp + (-gamma * Vzp - omega * omega * Zp) * dt + sigma * dWz[i]
            this.X_array[i] = Xp + Vxp * dt
            this.Y_array[i] = Yp + Vyp * dt
            this.Z_array[i] = Zp + Vzp * dt
        }

        this.Vx_array = emaCausal(this.Vx_array, alpha)
        this.Vy_array = emaCausal(this.Vy_array, alpha)
        this.Vz_array = emaCausal(this.Vz_array, alpha)

        let cx = 0
        let cy = 0
        let cz = 0
        for (let i = 0; i < this.N; i++) {
            cx += this.Vx_array[i]
            cy += this.Vy_array[i]
            cz += this.Vz_array[i]
            this.X_array[i] = cx * dt
            this.Y_array[i] = cy * dt
            this.Z_array[i] = cz * dt
        }

        this.Ax_array[0] = this.Vx_array[0] / dt
        this.Ay_array[0] = this.Vy_array[0] / dt
        this.Az_array[0] = this.Vz_array[0] / dt
        for (let i = 1; i < this.N; i++) {
            this.Ax_array[i] = (this.Vx_array[i] - this.Vx_array[i - 1]) / dt
            this.Ay_array[i] = (this.Vy_array[i] - this.Vy_array[i - 1]) / dt
            this.Az_array[i] = (this.Vz_array[i] - this.Vz_array[i - 1]) / dt
        }
    }

    evaluate(t) {
        const dt = this.parameter_values.dt
        const T  = this.parameter_values.T
        const tr = reflectTime(t, T)
        let i = Math.floor(tr / dt)
        if (i < 0) i = 0
        if (i >= this.N) i = this.N - 1
        const x = this.X_array[i]
        const y = this.Y_array[i]
        const z = this.Z_array[i]
        const vx = this.Vx_array[i]
        const vy = this.Vy_array[i]
        const vz = this.Vz_array[i]
        return [x, y, z, vx, vy, vz]
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
    const c = 2 * T
    let m = ((t % c) + c) % c
    return m <= T ? m : c - m
}