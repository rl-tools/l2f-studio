import { vec3, mat3, vec4, mat4, quat } from 'gl-matrix'; // vendored through the importmap in index.html
export class GamepadController{
    constructor(gamepad){
        this.actions = null
        this.actions_time = null
        gamepad.addListener((output) => {
            this.actions = output
            this.actions_time = performance.now()
        })
    }
    evaluate_step(state_bindings){
        return state_bindings.map((state_binding, i) => {
            const state = JSON.parse(state_binding.get_state());
            const params = JSON.parse(state_binding.get_parameters());

            const temp = vec3.create();
            vec3.scale(temp, omega, -this.k_omega);
            vec3.add(tau, tau, temp);

            const l = 0.028;
            const k_q = params['dynamics']['rotor_torque_constants'][0];

            const controlInputs = vec4.fromValues(T, tau[0], tau[1], tau[2]);

            const A = mat4.transpose(mat4.create(), mat4.fromValues(
                1, 1, 1, 1,
                -l, -l, l, l,
                -l, l, l, -l,
                -k_q, k_q, -k_q, k_q
            ));
            const A_inv = mat4.invert(mat4.create(), A);

            const f = vec4.transformMat4(vec4.create(), controlInputs, A_inv);
            const f_clipped = f.map(fi => Math.max(0, fi));

            function solveRPM(fi) {
                const discriminant = b * b - 4 * a * (c - fi);
                if (discriminant < 0 || fi < c) return 0.0;
                const rpm = (-b + Math.sqrt(discriminant)) / (2 * a);
                return Math.max(0.0, Math.min(1.0, rpm));
            }
            
            function solveRPM(fi){
                // a + b*rpm + c*rpm^2 = fi
                // c*rpm^2 + b*rpm + (a - fi) = 0
                const b_new = b/c
                const a_new = (a - fi)/c
                const d = b_new*b_new/4 - a_new
                if (d < 0) return 0.0;
                let rpm = -b_new/2 + Math.sqrt(d);
                if (rpm < 0){
                    rpm = -b_new/2 - Math.sqrt(d);
                };
                return rpm
            }

            const rpms = f_clipped.map(solveRPM);
            const rpms_clipped = rpms.map(x=> x > 1 ? 1 : (x < -1 ? -1 : x))
            return rpms_clipped.map(x => x * 2 - 1)
        })
    }
    reset() {
    }
}