import { Trajectory } from "./base.js"

export class SecondOrderLangevin extends Trajectory {
    constructor() {
        super({
            // Damping
            gamma:  { range: [0, 5],  default: 1.0 },
            // Natural frequency
            omega:  { range: [0, 10], default: 2.0 },
            // Noise strength
            sigma:  { range: [0, 5],  default: 0.5 },
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
        this.X_raw = new Array(this.N)
        this.Y_raw = new Array(this.N)
        this.Z_raw = new Array(this.N)
        this.Vx_raw = new Array(this.N)
        this.Vy_raw = new Array(this.N)
        this.Vz_raw = new Array(this.N)
        this.X = new Array(this.N)
        this.Y = new Array(this.N)
        this.Z = new Array(this.N)
        this.Vx = new Array(this.N)
        this.Vy = new Array(this.N)
        this.Vz = new Array(this.N)

        this.X_raw[0] = 0
        this.Y_raw[0] = 0
        this.Z_raw[0] = 0
        this.Vx_raw[0] = 0
        this.Vy_raw[0] = 0
        this.Vz_raw[0] = 0
        this.X[0] = 0
        this.Y[0] = 0
        this.Z[0] = 0
        this.Vx[0] = 0
        this.Vy[0] = 0
        this.Vz[0] = 0

        for (let i = 1; i < this.N; ++i) {
            for(let dim_i=0; dim_i<3; dim_i++) {
                const P_raw = dim_i === 0 ? this.X_raw : dim_i === 1 ? this.Y_raw : this.Z_raw;
                const V_raw = dim_i === 0 ? this.Vx_raw : dim_i === 1 ? this.Vy_raw : this.Vz_raw;
                const P = dim_i === 0 ? this.X : dim_i === 1 ? this.Y : this.Z;
                const V = dim_i === 0 ? this.Vx : dim_i === 1 ? this.Vy : this.Vz;
                const noise = randomGaussian() * Math.sqrt(dt);
                const v_raw = V_raw[i-1] + (-gamma*V_raw[i-1] - omega*omega*P_raw[i-1]) * dt + sigma * noise;
                V_raw[i] = v_raw;
                P_raw[i] = P_raw[i-1] + v_raw * dt;
                const v_smooth = alpha * v_raw + (1-alpha) * V[i-1];
                V[i] = v_smooth;
                P[i] = P[i-1] + v_smooth * dt;
            }
        }
    }

    evaluate(t) {
        const dt = this.parameter_values.dt
        const T  = this.parameter_values.T
        const tr = reflectTime(t, T)
        let i = Math.floor(tr / dt)
        if (i < 0) i = 0
        if (i >= this.N) i = this.N - 1
        const x = this.X[i]
        const y = this.Y[i]
        const z = this.Z[i]
        const vx = this.Vx[i]
        const vy = this.Vy[i]
        const vz = this.Vz[i]
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