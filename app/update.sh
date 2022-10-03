#!/bin/sh
yarn build
scp dist/* binaural.me:~/vrc/
