import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const sherpa = require('sherpa-onnx-node')

const modelDir =
  process.env.ROULETTE_ASR_MODEL_DIR ||
  path.join(process.env.APPDATA, 'roulette', 'models', 'sensevoice')
const wav = process.argv[2] || path.join(process.cwd(), 'out', 'asr-test.wav')

const wave = sherpa.readWave(wav)
console.log('wave:', wave.sampleRate, 'Hz', wave.samples.length, 'samples')

const config = {
  featConfig: { sampleRate: 16000, featureDim: 80 },
  modelConfig: {
    senseVoice: {
      model: path.join(modelDir, 'model.int8.onnx'),
      language: 'auto',
      useInverseTextNormalization: 1
    },
    tokens: path.join(modelDir, 'tokens.txt'),
    numThreads: 2,
    debug: 0,
    provider: 'cpu'
  }
}

const started = Date.now()
const recognizer = await sherpa.OfflineRecognizer.createAsync(config)
console.log('model loaded in', Date.now() - started, 'ms')

const stream = recognizer.createStream()
stream.acceptWaveform({ samples: wave.samples, sampleRate: wave.sampleRate })
const decodeStart = Date.now()
await recognizer.decodeAsync(stream)
const result = recognizer.getResult(stream)

console.log('decode in', Date.now() - decodeStart, 'ms')
console.log('RESULT:', JSON.stringify(result))
