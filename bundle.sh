npm install esbuild --save-dev 
npx esbuild dependencies/dependencies.js --bundle --minify --format=esm --outfile=lib/dependencies.js
npx esbuild dependencies/jsfive.js --bundle --minify --format=esm --outfile=lib/jsfive.js
npx esbuild dependencies/three.js --bundle --minify --format=esm --outfile=lib/three.js
npx esbuild dependencies/math.js --bundle --minify --format=esm --outfile=lib/math.js
npx esbuild dependencies/rltools.js --bundle --minify --format=esm --outfile=lib/rltools.js