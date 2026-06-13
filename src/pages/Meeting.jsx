import React, { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'

const ICE_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }

export default function Meeting() {
  const localVideoRef = useRef(null)
  const socketRef = useRef(null)
  const peersRef = useRef({}) // peerId -> RTCPeerConnection
  const streamsRef = useRef({}) // peerId -> MediaStream
  const [peerIds, setPeerIds] = useState([])
  const [participants, setParticipants] = useState([])
  const [joined, setJoined] = useState(false)
  const [audioEnabled, setAudioEnabled] = useState(true)
  const [videoEnabled, setVideoEnabled] = useState(true)
  const [status, setStatus] = useState('Ready')
  const localStreamRef = useRef(null)
  const roomRef = useRef('test-room')

  useEffect(() => {
    return () => {
      if (socketRef.current) socketRef.current.disconnect()
      Object.values(peersRef.current).forEach(pc => pc.close())
    }
  }, [])

  async function startLocal() {
    const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    localStreamRef.current = s
    if (localVideoRef.current) localVideoRef.current.srcObject = s
    setAudioEnabled(s.getAudioTracks().some(track => track.enabled))
    setVideoEnabled(s.getVideoTracks().some(track => track.enabled))
  }

  function toggleAudio() {
    if (!localStreamRef.current) return
    localStreamRef.current.getAudioTracks().forEach(track => {
      track.enabled = !track.enabled
    })
    setAudioEnabled(localStreamRef.current.getAudioTracks().some(track => track.enabled))
  }

  function toggleVideo() {
    if (!localStreamRef.current) return
    localStreamRef.current.getVideoTracks().forEach(track => {
      track.enabled = !track.enabled
    })
    setVideoEnabled(localStreamRef.current.getVideoTracks().some(track => track.enabled))
  }

  function createPeerConnection(peerId, s) {
    const pc = new RTCPeerConnection(ICE_CONFIG)
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        s.emit('signal', { to: peerId, from: s.id, signal: { type: 'ice', candidate: e.candidate } })
      }
    }
    pc.ontrack = (e) => {
      streamsRef.current[peerId] = e.streams[0]
      setPeerIds(Object.keys(streamsRef.current))
    }
    localStreamRef.current.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current))
    peersRef.current[peerId] = pc
    return pc
  }

  async function join() {
    if (joined) return
    try {
      setStatus('Starting local media...')
      await startLocal()
      setStatus('Connecting to room...')
      const s = io('http://localhost:3000')
      socketRef.current = s

      s.on('connect', () => {
        setStatus('Connected')
      })
      s.on('connect_error', () => {
        setStatus('Connection failed')
      })

      s.on('room-members', ({ peerIds: existingPeers }) => {
        setParticipants((prev) => {
          const combined = [...new Set([...prev, ...existingPeers])]
          return combined
        })
      })

      s.on('peer-joined', async ({ peerId }) => {
        setParticipants((prev) => {
          if (prev.includes(peerId)) return prev
          return [...prev, peerId]
        })
        const pc = createPeerConnection(peerId, s)
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        s.emit('signal', { to: peerId, from: s.id, signal: { type: 'offer', sdp: offer } })
      })

      s.on('signal', async (data) => {
        const { from, signal } = data
        let pc = peersRef.current[from]
        if (!pc) pc = createPeerConnection(from, s)
        if (signal.type === 'offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp))
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          s.emit('signal', { to: from, from: s.id, signal: { type: 'answer', sdp: answer } })
        } else if (signal.type === 'answer') {
          await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp))
        } else if (signal.type === 'ice') {
          try {
            await pc.addIceCandidate(signal.candidate)
          } catch (e) {
            console.warn('ICE add failed', e)
          }
        }
      })

      s.on('peer-left', ({ peerId }) => {
        delete streamsRef.current[peerId]
        setPeerIds(Object.keys(streamsRef.current))
        setParticipants((prev) => prev.filter((id) => id !== peerId))
        const pc = peersRef.current[peerId]
        if (pc) {
          pc.close()
          delete peersRef.current[peerId]
        }
      })

      s.on('connect', () => {
        setStatus('Connected')
        setParticipants([s.id])
      })

      s.emit('join', roomRef.current)
      setJoined(true)
      setStatus('Joined')
    } catch (err) {
      console.error(err)
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setStatus('Camera/microphone permission denied')
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setStatus('Camera or microphone not found')
      } else {
        setStatus('Join failed')
      }
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <h1>Meeting (React)</h1>
      <div style={{ marginBottom: 12 }}>
        <label>
          Room:
          <input defaultValue="test-room" onChange={e => (roomRef.current = e.target.value)} style={{ marginLeft: 8 }} />
        </label>
        <button onClick={join} style={{ marginLeft: 12 }} disabled={joined}>Join</button>
      </div>

      <div style={{ marginBottom: 12 }}>
        <span>Status: {status}</span>
        <span style={{ marginLeft: 16 }}>Participants: {participants.length}</span>
      </div>

      <div style={{ marginBottom: 12 }}>
        <strong>Room participants:</strong>
        <ul>
          {participants.map((id) => (
            <li key={id}>{id === (socketRef.current && socketRef.current.id) ? `${id} (you)` : id}</li>
          ))}
        </ul>
      </div>

      <div style={{ marginBottom: 12 }}>
        <button onClick={toggleAudio} disabled={!joined} style={{ marginRight: 8 }}>
          {audioEnabled ? 'Mute' : 'Unmute'}
        </button>
        <button onClick={toggleVideo} disabled={!joined}>
          {videoEnabled ? 'Stop camera' : 'Start camera'}
        </button>
      </div>

      <div>
        <h3>Local</h3>
        <video ref={localVideoRef} autoPlay muted playsInline style={{ width: 320, height: 240, background: '#000' }} />
      </div>

      <div>
        <h3>Peers</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap' }}>
          {peerIds.map(id => (
            <video
              key={id}
              id={`video-${id}`}
              autoPlay
              playsInline
              style={{ width: 320, height: 240, background: '#000', margin: 8 }}
              ref={(el) => { if (el && streamsRef.current[id]) el.srcObject = streamsRef.current[id] }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
