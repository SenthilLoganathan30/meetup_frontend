const socket = io('http://localhost:3000');
const localVideo = document.getElementById('localVideo');
const peersContainer = document.getElementById('peers');
const joinBtn = document.getElementById('joinBtn');
const roomInput = document.getElementById('roomInput');
const muteBtn = document.getElementById('muteBtn');
const cameraBtn = document.getElementById('cameraBtn');

let localStream;
let audioEnabled = true;
let videoEnabled = true;
const peers = {}; // peerId -> RTCPeerConnection
let participants = []
const participantsElement = document.getElementById('participants')
const participantListElement = document.getElementById('participantList')

function renderParticipants() {
  participantsElement.textContent = `Participants: ${participants.length}`
  if (!participantListElement) return
  participantListElement.innerHTML = participants.length > 0
    ? `<strong>Room participants:</strong><ul>${participants.map(id => `<li>${id}</li>`).join('')}</ul>`
    : ''
}

async function startLocal() {
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = localStream;
}

async function createPeerConnection(peerId, isInitiator) {
  const pc = new RTCPeerConnection();

  // send any ICE candidates to the other peer
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('signal', { to: peerId, from: socket.id, signal: { type: 'ice', candidate: event.candidate } });
    }
  };

  // when a remote stream arrives, show it in a video element
  pc.ontrack = (event) => {
    let el = document.getElementById('video-' + peerId);
    if (!el) {
      el = document.createElement('video');
      el.id = 'video-' + peerId;
      el.autoplay = true;
      el.playsInline = true;
      peersContainer.appendChild(el);
    }
    el.srcObject = event.streams[0];
  };

  // add local tracks
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

  peers[peerId] = pc;
  return pc;
}

const status = document.getElementById('status');

joinBtn.onclick = async () => {
  const room = roomInput.value.trim();
  if (!room) return alert('Enter room id');
  try {
    status.textContent = 'Status: requesting camera/microphone...';
    await startLocal();
    status.textContent = 'Status: joined';
    muteBtn.disabled = false;
    cameraBtn.disabled = false;
    socket.emit('join', room);
    participants = [socket.id]
    renderParticipants()
  } catch (err) {
    console.error(err);
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      status.textContent = 'Status: camera/microphone permission denied';
    } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      status.textContent = 'Status: camera or microphone not found';
    } else {
      status.textContent = 'Status: failed to access media';
    }
  }
};

muteBtn.onclick = () => {
  if (!localStream) return;
  audioEnabled = !audioEnabled;
  localStream.getAudioTracks().forEach(t => t.enabled = audioEnabled);
  muteBtn.textContent = audioEnabled ? 'Mute' : 'Unmute';
};

cameraBtn.onclick = () => {
  if (!localStream) return;
  videoEnabled = !videoEnabled;
  localStream.getVideoTracks().forEach(t => t.enabled = videoEnabled);
  cameraBtn.textContent = videoEnabled ? 'Camera Off' : 'Camera On';
};

socket.on('room-members', ({ peerIds: existingPeers }) => {
  existingPeers.forEach((peerId) => {
    if (!participants.includes(peerId)) {
      participants.push(peerId)
    }
  })
  renderParticipants()
})

socket.on('peer-joined', async ({ peerId }) => {
  if (!participants.includes(peerId)) {
    participants.push(peerId)
    renderParticipants()
  }
  const pc = await createPeerConnection(peerId, true);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('signal', { to: peerId, from: socket.id, signal: { type: 'offer', sdp: offer } });
});

socket.on('signal', async (data) => {
  const { from, signal } = data;
  let pc = peers[from];
  if (!pc) pc = await createPeerConnection(from, false);

  if (signal.type === 'offer') {
    await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('signal', { to: from, from: socket.id, signal: { type: 'answer', sdp: answer } });
  } else if (signal.type === 'answer') {
    await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
  } else if (signal.type === 'ice') {
    try {
      await pc.addIceCandidate(signal.candidate);
    } catch (e) {
      console.warn('Error adding ICE candidate', e);
    }
  }
});

socket.on('peer-left', ({ peerId }) => {
  const el = document.getElementById('video-' + peerId);
  if (el) el.remove();
  participants = participants.filter((id) => id !== peerId)
  renderParticipants()
  const pc = peers[peerId];
  if (pc) {
    pc.close();
    delete peers[peerId];
  }
});
