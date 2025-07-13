// The size of the audio buffer we want to send to the API.
// The model expects audio chunks of 100ms duration.
// At 16000 samples per second, 100ms is 1600 samples.
// We'll buffer a bit more to be safe and reduce message frequency.
const CHUNK_SIZE = 8192;

/**
 * AudioProcessor class for an AudioWorklet.
 *
 * This processor is responsible for receiving audio from the microphone,
 * downsampling it to 16kHz, buffering it into larger chunks,
 * converting it to 16-bit PCM format, and posting it back to the main thread.
 * This runs in a separate thread, ensuring the main UI thread is not blocked.
 */
class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(CHUNK_SIZE);
    this.bufferIndex = 0;
  }

  /**
   * Downsamples an input Float32Array from a source sample rate to a target sample rate.
   * @param {Float32Array} input The audio data to downsample.
   * @param {number} sourceSampleRate The original sample rate of the audio.
   * @param {number} targetSampleRate The desired sample rate.
   * @returns {Float32Array} The downsampled audio data.
   */
  downsample(input, sourceSampleRate, targetSampleRate) {
    if (sourceSampleRate === targetSampleRate) {
      return input;
    }
    const ratio = sourceSampleRate / targetSampleRate;
    const newLength = Math.floor(input.length / ratio);
    const result = new Float32Array(newLength);
    let inputIndex = 0;
    for (let i = 0; i < newLength; i++) {
      // A simple downsampling algorithm (averaging can be better but this is faster).
      result[i] = input[Math.floor(inputIndex)];
      inputIndex += ratio;
    }
    return result;
  }

  /**
   * The main processing function for the audio worklet.
   * This is called by the browser's audio engine with new audio data.
   * @param {Float32Array[][]} inputs Array of inputs, each with an array of channels.
   * @returns {boolean} `false` to terminate the processor, `true` to keep it alive.
   */
  process(inputs) {
    // We expect a single input with a single channel.
    const channelData = inputs[0]?.[0];

    if (!channelData) {
      return true; // Keep processor alive.
    }

    // Downsample the incoming 128-sample frame to our target 16kHz rate.
    // `sampleRate` is a global variable available in the AudioWorkletGlobalScope.
    const downsampledData = this.downsample(channelData, sampleRate, 16000);

    // Add the downsampled data to our buffer.
    for (let i = 0; i < downsampledData.length; i++) {
      this.buffer[this.bufferIndex++] = downsampledData[i];

      // When our buffer is full, send it to the main thread.
      if (this.bufferIndex === CHUNK_SIZE) {
        // Convert the Float32Array to a 16-bit PCM Int16Array.
        const pcmData = new Int16Array(this.buffer.length);
        for (let j = 0; j < this.buffer.length; j++) {
          const s = Math.max(-1, Math.min(1, this.buffer[j]));
          pcmData[j] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        // Post the data, transferring ownership of the underlying ArrayBuffer
        // to the main thread to avoid copying.
        this.port.postMessage(pcmData, [pcmData.buffer]);

        // Reset the buffer index to start filling it again.
        this.bufferIndex = 0;
      }
    }

    return true; // Keep the processor running.
  }
}

// Register the processor to be used in the AudioWorklet.
registerProcessor('audio-processor', AudioProcessor); 