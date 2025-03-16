import { vec3, vec4, mat4, quat } from 'https://esm.sh/gl-matrix';

export default class Controller {
    constructor() { }

    evaluate_step(state) {
        const stateDict = JSON.parse(state.get_state());
        const params = JSON.parse(state.get_parameters());

        const p = vec3.fromValues(...stateDict['position']);
        const q = quat.fromValues(
            stateDict['orientation'][1],
            stateDict['orientation'][2],
            stateDict['orientation'][3],
            stateDict['orientation'][0]
        );
        const v = vec3.fromValues(...stateDict['linear_velocity']);
        const omega = vec3.fromValues(...stateDict['angular_velocity']);

        const m = params['dynamics']['mass'];
        const g = -params['dynamics']['gravity'][2];
        const l = 0.028;
        const k_q = params['dynamics']['rotor_torque_constants'][0];
        const [a, b, c] = params['dynamics']['rotor_thrust_coefficients'][0];

        // Gains
        const k_p = 3.0;
        const k_d = 2.0;
        const k_R = 1.0;
        const k_omega = 0.1;

        // Desired states
        const p_des = vec3.fromValues(0, 0, 0);
        const v_des = vec3.fromValues(0, 0, 0);
        const q_des = quat.fromValues(0, 0, 0, 1);

        const e_p = vec3.subtract(vec3.create(), p, p_des);
        const e_v = vec3.subtract(vec3.create(), v, v_des);

        const a_fb = vec3.add(
            vec3.create(),
            vec3.scale(vec3.create(), e_p, -k_p),
            vec3.scale(vec3.create(), e_v, -k_d)
        );

        const F_des = vec3.fromValues(0, 0, m * g);
        vec3.add(F_des, F_des, vec3.scale(vec3.create(), a_fb, m));

        const A = mat4.fromValues(
            1, 1, 1, 1,
            -l, -l, l, l,
            -l, l, l, -l,
            -k_q, k_q, -k_q, k_q
        );
        const A_inv = mat4.invert(mat4.create(), A);

        const T = vec3.dot(F_des, vec3.transformQuat(vec3.create(), [0, 0, 1], q));
        const tau = vec3.add(
            vec3.create(),
            vec3.scale(vec3.create(), omega, -k_omega),
            vec3.scale(vec3.create(), e_p, -k_R)
        );

        const controlInputs = vec4.fromValues(T, tau[0], tau[1], tau[2]);
        const f = vec4.transformMat4(vec4.create(), controlInputs, A_inv);

        const f_clipped = f.map(fi => Math.max(0, fi));

        function solveRPM(fi) {
            const discriminant = b * b - 4 * a * (c - fi);
            if (discriminant < 0 || fi < c) return 0.0;
            const rpm = (-b + Math.sqrt(discriminant)) / (2 * a);
            return Math.max(0.0, Math.min(1.0, rpm));
        }

        return f_clipped.map(solveRPM);
    }

    reset() { }
}

