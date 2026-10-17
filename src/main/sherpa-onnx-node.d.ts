declare module 'sherpa-onnx-node' {
  export interface OfflineRecognizerResult {
    text: string
    lang?: string
    emotion?: string
    event?: string
    tokens?: string[]
  }

  export interface OfflineStream {
    acceptWaveform(obj: { samples: Float32Array; sampleRate: number }): void
  }

  export class OfflineRecognizer {
    static createAsync(config: Record<string, unknown>): Promise<OfflineRecognizer>
    createStream(hotwords?: string): OfflineStream
    decode(stream: OfflineStream): void
    decodeAsync(stream: OfflineStream): Promise<OfflineRecognizerResult>
    getResult(stream: OfflineStream): OfflineRecognizerResult
  }

  export const version: string
}
