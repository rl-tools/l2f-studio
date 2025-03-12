npm install esbuild --save-dev 
npx esbuild dependencies/dependencies.js --bundle --minify --format=esm --outfile=blob/lib/dependencies.js
npx esbuild dependencies/jsfive.js --bundle --minify --format=esm --outfile=blob/lib/jsfive.js
npx esbuild dependencies/three.js --bundle --minify --format=esm --outfile=blob/lib/three.js
npx esbuild dependencies/math.js --bundle --minify --format=esm --outfile=blob/lib/math.js
#npx esbuild dependencies/rltools.js --bundle --format=esm --outfile=blob/lib/rltools.js
cp ../rltools.js/main.js blob/lib/rltools.js