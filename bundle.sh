npm install esbuild --save-dev 
npx esbuild dependencies/dependencies.js --bundle --minify --format=esm --outfile=blob/lib/dependencies.js
# npx esbuild dependencies/jsfive.js --bundle --minify --format=esm --outfile=blob/lib/jsfive.js  # replaced by dyn-inference WASM
npx esbuild dependencies/three.js --bundle --minify --format=esm --outfile=blob/lib/three.js
npx esbuild dependencies/math.js --bundle --minify --format=esm --outfile=blob/lib/math.js
npx esbuild dependencies/stats.js --bundle --minify --format=esm --outfile=blob/lib/stats.js
# rltools.js replaced by dyn-inference WASM module (built via build_dyn_inference.sh)
# cp ../../rl-tools/static/rltools.js/main.js blob/lib/rltools.js
