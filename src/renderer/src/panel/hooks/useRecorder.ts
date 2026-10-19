import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface RecorderCallbacks {
  onTranscribed: (text: string) => void
  onToast: (message: string) => void
  onOpenSettings: () => void
}

interface RecorderState {
  recording: boolean
  recordSeconds: number
  transcribing: boolean
  level: number
  noSound: boolean
}

interface RecorderActions {
  beginRecording: () => Promise<void>
  stopRecording: () => void
  abortRecording: () => void
}

async function decodeAudio(
  blob: Blob
): Promise<{ samples: Float32Array; sampleRate: number }> {
  const buffer = await blob.arrayBuffer()
  // Decode straight to the recognizer's rate. The default 48 kHz AudioContext
  // would send ~3x more samples over IPC and force a JS resample in main.
  let context: AudioContext
  try {
    context = new AudioContext({ sampleRate: 16000 })
  } catch {
    context = new AudioContext()
  }
  try {
    const audio = await context.decodeAudioData(buffer)
    return {
      samples: new Float32Array(audio.getChannelData(0)),
      sampleRate: audio.sampleRate
    }
  } finally {
    void context.close()
  }
}

export function useRecorder(
  callbacks: RecorderCallbacks
): RecorderState & RecorderActions {
  const { t } = useTranslation()
  const [recording, setRecording] = useState(false)
  const [recordSeconds, setRecordSeconds] = useState(0)
  const [transcribing, setTranscribing] = useState(false)
  const [level, setLevel] = useState(0)
  const [noSound, setNoSound] = useState(false)

  const callbacksRef = useRef(callbacks)
  callbacksRef.current = callbacks

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const transcribingRef = useRef(false)
  const audioMeterRef = useRef<{
    ctx: AudioContext
    analyser: AnalyserNode
    data: Uint8Array<ArrayBuffer>
  } | null>(null)
  const levelRafRef = useRef<number | null>(null)
  const finishRecordingRef = useRef<() => Promise<void>>(async () => {})

  const stopLevelMeter = useCallback((): void => {
    if (levelRafRef.current != null) {
      cancelAnimationFrame(levelRafRef.current)
      levelRafRef.current = null
    }
    const meter = audioMeterRef.current
    audioMeterRef.current = null
    if (meter) void meter.ctx.close().catch(() => {})
    setLevel(0)
    setNoSound(false)
  }, [])

  const startLevelMeter = useCallback(
    (stream: MediaStream): void => {
      stopLevelMeter()
      try {
        const ctx = new AudioContext()
        const source = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 512
        source.connect(analyser)
        const data = new Uint8Array(new ArrayBuffer(analyser.fftSize))
        audioMeterRef.current = { ctx, analyser, data }
        void ctx.resume().catch(() => {})
        const started = Date.now()
        let peak = 0
        let lastUpdate = 0
        const tick = (): void => {
          const meter = audioMeterRef.current
          if (!meter) return
          meter.analyser.getByteTimeDomainData(meter.data)
          let sum = 0
          for (let i = 0; i < meter.data.length; i += 1) {
            const value = (meter.data[i] - 128) / 128
            sum += value * value
          }
          const rms = Math.sqrt(sum / meter.data.length)
          peak = Math.max(peak, rms)
          const now = performance.now()
          if (now - lastUpdate > 90) {
            lastUpdate = now
            setLevel(Math.min(1, rms * 5))
          }
          if (Date.now() - started > 2000 && peak < 0.008) setNoSound(true)
          levelRafRef.current = requestAnimationFrame(tick)
        }
        tick()
      } catch {
        // Metering is optional; recording still works without it.
      }
    },
    [stopLevelMeter]
  )

  const abortRecording = useCallback((): void => {
    const recorder = recorderRef.current
    recorderRef.current = null
    if (recorder) {
      recorder.onstop = null
      try {
        recorder.stop()
      } catch {
        // Already stopped.
      }
    }
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    chunksRef.current = []
    stopLevelMeter()
    setRecording(false)
  }, [stopLevelMeter])

  const stopRecording = useCallback((): void => {
    const recorder = recorderRef.current
    if (!recorder) return
    recorderRef.current = null
    recorder.stop()
  }, [])

  const finishRecording = useCallback(async (): Promise<void> => {
    setRecording(false)
    stopLevelMeter()
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null

    const chunks = chunksRef.current
    chunksRef.current = []
    if (chunks.length === 0) return

    const blob = new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' })
    if (blob.size === 0) return

    transcribingRef.current = true
    setTranscribing(true)
    try {
      const audio = await decodeAudio(blob)
      const result = await window.roulette.transcribe(audio)
      const text = result.text.trim()
      if (!text) {
        callbacksRef.current.onToast(t('emptyTranscript'))
        return
      }
      callbacksRef.current.onTranscribed(text)
    } catch (error) {
      callbacksRef.current.onToast(
        `${t('asrFailed')}${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      transcribingRef.current = false
      setTranscribing(false)
    }
  }, [stopLevelMeter, t])
  finishRecordingRef.current = finishRecording

  const beginRecording = useCallback(async (): Promise<void> => {
    if (recorderRef.current || transcribingRef.current) return

    try {
      const status = await window.roulette.getAsrStatus()
      if (!status.installed) {
        callbacksRef.current.onToast(t('asrNotInstalled'))
        callbacksRef.current.onOpenSettings()
        return
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
      })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'
      const recorder = new MediaRecorder(stream, { mimeType })

      streamRef.current = stream
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        void finishRecordingRef.current()
      }
      recorder.start(250)
      recorderRef.current = recorder
      setRecordSeconds(0)
      setRecording(true)
      startLevelMeter(stream)
    } catch (error) {
      callbacksRef.current.onToast(
        `${t('micDenied')} ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }, [startLevelMeter, t])

  useEffect(() => {
    if (!recording) return
    const started = Date.now()
    const timer = window.setInterval(() => {
      const seconds = Math.floor((Date.now() - started) / 1000)
      setRecordSeconds(seconds)
      if (seconds >= 60) stopRecording()
    }, 500)
    return () => window.clearInterval(timer)
  }, [recording, stopRecording])

  useEffect(() => {
    return window.roulette.onTestStopRecording(() => stopRecording())
  }, [stopRecording])

  useEffect(() => {
    return () => {
      const recorder = recorderRef.current
      if (recorder) {
        recorder.onstop = null
        try {
          recorder.stop()
        } catch {
          // Already stopped.
        }
      }
      streamRef.current?.getTracks().forEach((track) => track.stop())
      if (levelRafRef.current != null) cancelAnimationFrame(levelRafRef.current)
      const meter = audioMeterRef.current
      audioMeterRef.current = null
      if (meter) void meter.ctx.close().catch(() => {})
    }
  }, [])

  return {
    recording,
    recordSeconds,
    transcribing,
    level,
    noSound,
    beginRecording,
    stopRecording,
    abortRecording
  }
}
