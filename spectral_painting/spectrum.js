"use strict";
const ctx = new AudioContext();
const analyser = ctx.createAnalyser();
let start = 0;
let cnvs = null;
window.onload = () => {
    const audio = document.getElementById("aud");
    const src = document.getElementById("aud_src");
    analyser.maxDecibels = 0;
    analyser.connect(ctx.destination);
    cnvs = document.getElementById("cnvs").getContext("2d");
    var blob = window.URL || window.webkitURL;
    if (!blob) {
        window.alert('Your browser does not support Blob URLs :(');
        return;
    }
    audio.onplay = () => {
        start = ctx.currentTime;
    };
    src.oninput = () => {
        if (src.files == null) {
            window.alert('Awaiting file input');
            return;
        }
        audio.src = blob.createObjectURL(src.files[0]);
        const ctx_source = ctx.createMediaElementSource(audio);
        ctx_source.connect(ctx.destination);
        ctx_source.connect(analyser);
        ctx_source.mediaElement.play();
        ctx.resume();
        update();
    };
};
const blockWidth = 100;
const low = 1;
const high = ctx.sampleRate / 2;
const height = 1080;
function normalize_exponential(value) {
    return (1 - Math.log(value + 1) / Math.log(high + 1)) * height;
}
function update() {
    const array = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(array);
    let last = 1080;
    array.forEach((f, i) => {
        const x = blockWidth * (ctx.currentTime - start);
        const y = normalize_exponential(i / analyser.frequencyBinCount * high);
        const h = last - y;
        last = y;
        const l = 255 * (f - analyser.minDecibels) / (analyser.maxDecibels - analyser.minDecibels);
        if (!cnvs) {
            return;
        }
        cnvs.fillStyle = `rgb(${l},${l}, 0)`;
        cnvs.fillRect(x, y, blockWidth, h);
    });
    requestAnimationFrame(update);
}
