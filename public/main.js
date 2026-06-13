const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const backendUrl = isLocalhost ? 'http://localhost:3000' : 'https://meetupapp-production-dd75.up.railway.app';
const socket = io(backendUrl);

// DOM Elements
const homeView = document.getElementById('landingView');
const meetingView = document.getElementById('meetingView');

const localVideo = document.getElementById('localVideo');
const peersContainer = document.getElementById('peers');
const joinBtn = document.getElementById('joinBtn');
const leaveBtn = document.getElementById('leaveBtn');
const roomInput = document.getElementById('roomInput');
const nameInput = document.getElementById('nameInput');
const muteBtn = document.getElementById('muteBtn');
const cameraBtn = document.getElementById('cameraBtn');
const shareBtn = document.getElementById('shareBtn');
const status = document.getElementById('status');
const participantsElement = document.getElementById('participants');

const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const chatSendBtn = document.getElementById('chatSendBtn');
const chatMessages = document.getElementById('chatMessages');
const localBadge = document.getElementById('localBadge');

// New DOM Elements
const recordBtn = document.getElementById('recordBtn');
const whiteboardBtn = document.getElementById('whiteboardBtn');
const captionsBtn = document.getElementById('captionsBtn');
const summaryBtn = document.getElementById('summaryBtn');
const canvas = document.getElementById('whiteboardCanvas');
const captionsContainer = document.getElementById('captionsContainer');
const summaryContent = document.getElementById('summaryContent');
const downloadSummaryBtn = document.getElementById('downloadSummaryBtn');

// New AI/Feature DOM Elements
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const attendanceBtn = document.getElementById('attendanceBtn');
const infoModal = document.getElementById('infoModal');
const infoModalTitle = document.getElementById('infoModalTitle');
const infoModalContent = document.getElementById('infoModalContent');
const closeInfoModalBtn = document.getElementById('closeInfoModalBtn');

// State
let localStream;
let displayStream;
let audioEnabled = true;
let videoEnabled = true;
let isSharingScreen = false;
let currentRoom = null;
let userName = 'Guest';
let meetingTimerInterval = null;
let meetingStartTime = null;

const peers = {}; // peerId -> RTCPeerConnection
let participants = new Map(); // peerId -> userInfo

// Features State
let mediaRecorder;
let recordedChunks = [];
let isRecording = false;

let ctx = canvas.getContext('2d');
let isWhiteboardActive = false;
let isDrawing = false;
let currentPos = { x: 0, y: 0 };

let recognition;
let isCaptionsActive = false;

function renderParticipants() {
  participantsElement.textContent = `${participants.size + 1}`; // +1 for self
  updateEmptyState();
}

function updateEmptyState() {
  const emptyState = document.getElementById('emptyState');
  if (!emptyState) return;
  if (participants.size === 0) {
    emptyState.classList.remove('hidden');
  } else {
    emptyState.classList.add('hidden');
  }
}

async function startLocal() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (err) {
    console.warn("Failed to get video/audio, falling back to empty stream...", err);
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
    } catch (err2) {
      console.warn("Failed to get audio, creating empty dummy stream", err2);
      localStream = new MediaStream(); // empty stream so the app doesn't crash
    }
  }
  localVideo.srcObject = localStream;
}

function broadcastMediaState() {
  if (currentRoom) {
    socket.emit('media-state', {
      roomId: currentRoom,
      isMuted: !audioEnabled,
      isVideoOff: !videoEnabled
    });
  }
}

async function createPeerConnection(peerId, isInitiator) {
  const configuration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };
  const pc = new RTCPeerConnection(configuration);

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('signal', { to: peerId, from: socket.id, signal: { type: 'ice', candidate: event.candidate } });
    }
  };

  pc.ontrack = (event) => {
    let wrapper = document.getElementById('wrapper-' + peerId);
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.id = 'wrapper-' + peerId;
      wrapper.className = 'video-wrapper';

      const video = document.createElement('video');
      video.id = 'video-' + peerId;
      video.autoplay = true;
      video.playsInline = true;

      const badge = document.createElement('div');
      badge.className = 'peer-name-badge';
      badge.id = 'badge-' + peerId;
      
      const peerInfo = participants.get(peerId);
      const peerName = (peerInfo && peerInfo.name) ? peerInfo.name : 'Guest';
      const nameText = document.createTextNode(peerName);
      badge.appendChild(nameText);

      const muteIcon = document.createElement('i');
      muteIcon.className = 'fa-solid fa-microphone-slash peer-mute-icon';
      muteIcon.id = 'mute-icon-' + peerId;
      muteIcon.style.display = (peerInfo && peerInfo.isMuted) ? 'inline-block' : 'none';
      badge.appendChild(muteIcon);
      
      // Avatar initials overlay
      const videoOffOverlay = document.createElement('div');
      videoOffOverlay.className = 'peer-video-off-overlay';
      videoOffOverlay.id = 'video-off-' + peerId;
      const avatarColors = ['#5438DC','#8b5cf6','#3b82f6','#10b981','#f59e0b','#ef4444'];
      const avatarColor = avatarColors[peerName.charCodeAt(0) % avatarColors.length];
      const initials = peerName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2);
      videoOffOverlay.innerHTML = `<div class="peer-avatar" style="background:${avatarColor}">${initials}</div><span>${peerName}</span>`;
      videoOffOverlay.style.display = (peerInfo && peerInfo.isVideoOff) ? 'flex' : 'none';

      // Advanced Overlay Controls (PiP, Pin)
      const overlayControls = document.createElement('div');
      overlayControls.className = 'video-overlay-controls';
      overlayControls.innerHTML = `
        <button class="overlay-btn pin-btn" title="Pin Video"><i class="fa-solid fa-thumbtack"></i></button>
        <button class="overlay-btn pip-btn" title="Picture in Picture"><i class="fa-solid fa-clone"></i></button>
      `;

      wrapper.appendChild(video);
      wrapper.appendChild(badge);
      wrapper.appendChild(videoOffOverlay);
      wrapper.appendChild(overlayControls);
      peersContainer.appendChild(wrapper);

      // Attach Handlers
      const pinBtn = overlayControls.querySelector('.pin-btn');
      pinBtn.onclick = (e) => {
        e.stopPropagation();
        const isPinned = wrapper.classList.toggle('pinned-spotlight');
        if (isPinned) {
          // Remove pin from others
          document.querySelectorAll('.video-wrapper.pinned-spotlight').forEach(w => {
            if (w !== wrapper) w.classList.remove('pinned-spotlight');
          });
          pinBtn.style.color = 'var(--primary)';
        } else {
          pinBtn.style.color = '';
        }
      };

      const pipBtn = overlayControls.querySelector('.pip-btn');
      pipBtn.onclick = async (e) => {
        e.stopPropagation();
        try {
          if (document.pictureInPictureElement !== video) {
            await video.requestPictureInPicture();
          } else {
            await document.exitPictureInPicture();
          }
        } catch(err) { console.error('PiP error', err); }
      };

      if (peerInfo && peerInfo.isSharingScreen) {
        wrapper.classList.add('spotlight');
        peersContainer.classList.add('has-spotlight');
      }
    }

    const videoEl = document.getElementById('video-' + peerId);
    videoEl.srcObject = event.streams[0];
  };

  // Add tracks
  const streamToShare = isSharingScreen ? displayStream : localStream;
  streamToShare.getTracks().forEach((t) => pc.addTrack(t, streamToShare));

  peers[peerId] = pc;
  return pc;
}

function generateRoomId() {
  return 'meet-' + Math.random().toString(36).substring(2, 10);
}

// View Routing
function showView(viewId) {
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  const target = document.getElementById(viewId);
  if (target) target.classList.add('active');
}

document.querySelectorAll('.navToDashboardBtn').forEach(btn => {
  btn.onclick = () => showView('dashboardView');
});

document.querySelectorAll('.navToConfigCreateBtn').forEach(btn => {
  btn.onclick = () => {
    document.getElementById('roomInput').value = generateRoomId();
    showView('configView');
  };
});

document.querySelectorAll('.navToConfigJoinBtn').forEach(btn => {
  btn.onclick = () => {
    document.getElementById('roomInput').value = '';
    showView('configView');
  };
});

// Search functionality
searchBtn.onclick = () => {
  const query = searchInput.value.trim();
  if (!query) return alert('Please enter a search term');
  
  infoModal.classList.remove('hidden');
  infoModalTitle.innerHTML = '<i class="fa-solid fa-search"></i> Search Results';
  infoModalContent.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Searching knowledge base...';
  
  socket.emit('search-meetings', { query }, (res) => {
    if (!res.success) {
      infoModalContent.innerHTML = `<span style="color:var(--danger)">Error: ${res.error}</span>`;
      return;
    }
    if (res.results.length === 0) {
      infoModalContent.innerHTML = 'No results found.';
      return;
    }
    
    let html = '<ul style="list-style:none; padding:0; display:flex; flex-direction:column; gap:1rem;">';
    res.results.forEach(r => {
      html += `
        <li style="border-bottom: 1px solid var(--border-light); padding-bottom: 0.5rem;">
          <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom:0.25rem;">
            <strong>${r.sender_name}</strong> in Room: <em>${r.room_id}</em> at ${r.timestamp}
          </div>
          <div>${r.text}</div>
        </li>
      `;
    });
    html += '</ul>';
    infoModalContent.innerHTML = html;
  });
};

// Navigation Panel Logic
function showLandingPanel(panelId) {
  document.querySelectorAll('.landing-panel').forEach(p => p.classList.add('hidden'));
  document.getElementById(panelId).classList.remove('hidden');
  document.querySelectorAll('#navHome, #navFeatures, #navAbout').forEach(el => {
    el.style.fontWeight = 'normal';
    el.style.color = '';
  });
  const activeNav = document.getElementById(panelId.replace('landing', 'nav'));
  if (activeNav) {
    activeNav.style.fontWeight = '600';
    activeNav.style.color = 'var(--primary)';
  }
}

document.getElementById('navHome').onclick = () => showLandingPanel('landingHome');
document.getElementById('navFeatures').onclick = () => showLandingPanel('landingFeatures');
document.getElementById('navAbout').onclick = () => showLandingPanel('landingAbout');

function showDashPanel(panelId) {
  document.querySelectorAll('.dash-panel').forEach(p => p.classList.add('hidden'));
  document.getElementById(panelId).classList.remove('hidden');
  document.querySelectorAll('.sidebar-nav-item').forEach(el => el.classList.remove('active'));
  document.getElementById(panelId.replace('dash', 'side')).classList.add('active');
}

document.getElementById('sideHome').onclick = () => showDashPanel('dashHome');
document.getElementById('sideCalendar').onclick = () => showDashPanel('dashCalendar');
document.getElementById('sideRecordings').onclick = () => showDashPanel('dashRecordings');
document.getElementById('sideSettings').onclick = () => showDashPanel('dashSettings');

const galleryBtn = document.getElementById('galleryBtn');
if (galleryBtn) {
  galleryBtn.onclick = () => {
    alert('Gallery View is active! Spotlight mode activates automatically when someone shares their screen.');
  };
}

// Init
showView('landingView');

// ========================
// NEW FEATURE: COPY ROOM ID
// ========================
document.getElementById('copyRoomBtn').addEventListener('click', () => {
  if (!currentRoom) return;
  navigator.clipboard.writeText(currentRoom).then(() => {
    const btn = document.getElementById('copyRoomBtn');
    btn.classList.add('copied');
    btn.innerHTML = '<i class="fa-solid fa-check"></i>';
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.innerHTML = '<i class="fa-solid fa-copy"></i>';
    }, 2000);
  });
});

// ========================
// NEW FEATURE: EMOJI REACTIONS
// ========================
document.querySelectorAll('.emoji-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const emoji = btn.dataset.emoji;
    spawnFloatingEmoji(emoji);
    if (currentRoom) socket.emit('emoji-reaction', { roomId: currentRoom, emoji });
  });
});

function spawnFloatingEmoji(emoji) {
  const meetingArea = document.querySelector('.video-area');
  if (!meetingArea) return;
  const el = document.createElement('span');
  el.className = 'floating-emoji';
  el.textContent = emoji;
  const rect = meetingArea.getBoundingClientRect();
  el.style.left = (20 + Math.random() * (rect.width - 80)) + 'px';
  el.style.bottom = '20px';
  meetingArea.style.position = 'relative';
  meetingArea.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

socket.on('emoji-reaction', ({ emoji }) => spawnFloatingEmoji(emoji));

// ========================
// NEW FEATURE: PARTICIPANT LIST PANEL
// ========================
document.getElementById('participantsListBtn').addEventListener('click', () => {
  const panel = document.getElementById('participantsPanel');
  const chatPanel = document.getElementById('chatPanel');
  const summaryPanel = document.getElementById('summaryPanel');
  chatPanel.classList.remove('active');
  summaryPanel.classList.remove('active');
  panel.classList.toggle('active');
  if (panel.classList.contains('active')) renderParticipantList();
});

function renderParticipantList() {
  const container = document.getElementById('participantListContent');
  if (!container) return;
  const avatarColors = ['#5438DC','#8b5cf6','#3b82f6','#10b981','#f59e0b','#ef4444'];
  // Self
  const selfInitials = userName.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
  const selfColor = avatarColors[userName.charCodeAt(0) % avatarColors.length];
  let html = `<div class="participant-list-item">
    <div class="p-avatar" style="background:${selfColor}">${selfInitials}</div>
    <div class="p-name">${userName} <span style="font-size:0.75rem;color:var(--text-muted);">(You)</span></div>
    <div class="p-status-icons">
      ${!audioEnabled ? '<i class="fa-solid fa-microphone-slash muted"></i>' : '<i class="fa-solid fa-microphone"></i>'}
      ${!videoEnabled ? '<i class="fa-solid fa-video-slash muted"></i>' : '<i class="fa-solid fa-video"></i>'}
    </div>
  </div>`;
  participants.forEach((info, peerId) => {
    const n = info.name || 'Guest';
    const initials = n.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
    const color = avatarColors[n.charCodeAt(0) % avatarColors.length];
    html += `<div class="participant-list-item">
      <div class="p-avatar" style="background:${color}">${initials}</div>
      <div class="p-name">${n}</div>
      <div class="p-status-icons">
        ${info.isMuted ? '<i class="fa-solid fa-microphone-slash muted"></i>' : '<i class="fa-solid fa-microphone"></i>'}
        ${info.isVideoOff ? '<i class="fa-solid fa-video-slash muted"></i>' : '<i class="fa-solid fa-video"></i>'}
      </div>
    </div>`;
  });
  container.innerHTML = html;
}

// ========================
// NEW FEATURE: SPEAKING INDICATOR (audio analyser)
// ========================
let audioContext, analyser, speakCheckInterval;
function startSpeakingDetection(stream) {
  if (!stream.getAudioTracks().length) return;
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const dataArray = new Uint8Array(analyser.fftSize);
    const localWrapper = document.querySelector('.local-video-container');
    speakCheckInterval = setInterval(() => {
      analyser.getByteTimeDomainData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) sum += Math.abs(dataArray[i] - 128);
      const avg = sum / dataArray.length;
      if (localWrapper) {
        if (avg > 5) localWrapper.style.borderColor = 'var(--success)';
        else localWrapper.style.borderColor = '';
      }
    }, 150);
  } catch(e) { console.warn('Speaking detection unavailable', e); }
}

joinBtn.onclick = async () => {
  const room = roomInput.value.trim();
  userName = nameInput.value.trim() || 'Guest';
  
  if (!room) return alert('Enter room id');
  try {
    status.innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="color:var(--text-muted)"></i> connecting...';
    await startLocal();
    status.innerHTML = '<i class="fa-solid fa-circle-check" style="color: var(--success)"></i> Connected';
    localBadge.textContent = `${userName} (You)`;
    
    currentRoom = room;
    document.getElementById('headerRoomName').textContent = room;
    
    const preMute = !document.getElementById('preMuteCheck').checked;
    const preVideoOff = !document.getElementById('preVideoCheck').checked;
    
    audioEnabled = !preMute;
    videoEnabled = !preVideoOff;
    localStream.getAudioTracks().forEach(t => t.enabled = audioEnabled);
    localStream.getVideoTracks().forEach(t => t.enabled = videoEnabled);
    
    muteBtn.innerHTML = audioEnabled ? '<i class="fa-solid fa-microphone"></i>' : '<i class="fa-solid fa-microphone-slash"></i>';
    if (!audioEnabled) muteBtn.classList.add('active-off');
    else muteBtn.classList.remove('active-off');
    
    cameraBtn.innerHTML = videoEnabled ? '<i class="fa-solid fa-video"></i>' : '<i class="fa-solid fa-video-slash"></i>';
    if (!videoEnabled) cameraBtn.classList.add('active-off');
    else cameraBtn.classList.remove('active-off');

    // Request to join the room
    socket.emit('request-join', { roomId: room, name: userName });
    
  } catch (err) {
    console.error(err);
    alert('Failed to access media');
  }
};

// ========================
// LOBBY AND JOIN HANDLERS
// ========================

socket.on('lobby-waiting', () => {
  status.innerHTML = '<i class="fa-solid fa-clock" style="color:var(--warning)"></i> Waiting';
  document.getElementById('lobbyMsg').textContent = 'Waiting for the host to let you in...';
  showView('lobbyView');
});

socket.on('join-denied', () => {
  document.getElementById('lobbyMsg').innerHTML = '<span style="color:var(--danger)">The host declined your request to join.</span>';
});

socket.on('join-accepted', (data) => {
  status.innerHTML = '<i class="fa-solid fa-circle-check" style="color: var(--success)"></i> Connected';
  showView('meetingView');

  if (data.isHost) {
    isHost = true;
    const createPollSection = document.getElementById('createPollSection');
    if (createPollSection) createPollSection.style.display = 'block';
  }

  // Update empty state self avatar
  const esColors = ['#5438DC','#8b5cf6','#3b82f6','#10b981','#f59e0b','#ef4444'];
  const esInitials = userName.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2) || 'G';
  const esColor = esColors[userName.charCodeAt(0) % esColors.length];
  const selfAvatarEl = document.getElementById('selfAvatarLarge');
  const selfNameEl = document.getElementById('selfNameLarge');
  if (selfAvatarEl) { selfAvatarEl.textContent = esInitials; selfAvatarEl.style.background = `linear-gradient(135deg,${esColor},#8b5cf6)`; }
  if (selfNameEl) selfNameEl.textContent = userName;
  updateEmptyState();
  
  // Start timer
  meetingStartTime = Date.now();
  document.getElementById('meetingTimer').textContent = '00:00';
  if (meetingTimerInterval) clearInterval(meetingTimerInterval);
  meetingTimerInterval = setInterval(() => {
    const diff = Math.floor((Date.now() - meetingStartTime) / 1000);
    const m = String(Math.floor(diff / 60)).padStart(2, '0');
    const s = String(diff % 60).padStart(2, '0');
    document.getElementById('meetingTimer').textContent = `${m}:${s}`;
  }, 1000);
  
  // Start speaking detection
  startSpeakingDetection(localStream);
  
  // Setup peers
  if (data && data.peers) {
    data.peers.forEach((peer) => {
      participants.set(peer.id, peer);
      createPeerConnection(peer.id, true);
    });
  }
  
  renderParticipants();
  broadcastMediaState();
});

leaveBtn.onclick = () => {
  if (confirm('Are you sure you want to leave the meeting?')) {
    if (meetingTimerInterval) clearInterval(meetingTimerInterval);
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    if (displayStream) displayStream.getTracks().forEach(t => t.stop());
    socket.disconnect(); // properly trigger server disconnect logic
    showView('endedView');
  }
};

muteBtn.onclick = () => {
  if (!localStream) return;
  audioEnabled = !audioEnabled;
  localStream.getAudioTracks().forEach(t => t.enabled = audioEnabled);
  muteBtn.innerHTML = audioEnabled
    ? '<i class="fa-solid fa-microphone"></i><span>Mute</span>'
    : '<i class="fa-solid fa-microphone-slash"></i><span>Unmute</span>';
  if (!audioEnabled) muteBtn.classList.add('active-off');
  else muteBtn.classList.remove('active-off');
  broadcastMediaState();
};

cameraBtn.onclick = () => {
  if (!localStream) return;
  videoEnabled = !videoEnabled;
  localStream.getVideoTracks().forEach(t => t.enabled = videoEnabled);
  cameraBtn.innerHTML = videoEnabled
    ? '<i class="fa-solid fa-video"></i><span>Camera</span>'
    : '<i class="fa-solid fa-video-slash"></i><span>Camera</span>';
  if (!videoEnabled) cameraBtn.classList.add('active-off');
  else cameraBtn.classList.remove('active-off');
  broadcastMediaState();
};

shareBtn.onclick = async () => {
  if (!isSharingScreen) {
    try {
      displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      isSharingScreen = true;
      socket.emit('screen-share', { roomId: currentRoom, isSharing: true });
      shareBtn.innerHTML = '<i class="fa-solid fa-desktop"></i><span>Sharing</span>';
      shareBtn.style.color = 'var(--primary)';
      
      const videoTrack = displayStream.getVideoTracks()[0];
      localVideo.srcObject = displayStream;

      videoTrack.onended = () => {
        stopScreenShare();
      };

      for (const peerId in peers) {
        const pc = peers[peerId];
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) sender.replaceTrack(videoTrack);
      }
    } catch (err) {
      console.error("Error sharing screen", err);
    }
  } else {
    stopScreenShare();
  }
};

function stopScreenShare() {
  if (!isSharingScreen) return;
  isSharingScreen = false;
  socket.emit('screen-share', { roomId: currentRoom, isSharing: false });
  displayStream.getTracks().forEach(t => t.stop());
  shareBtn.innerHTML = '<i class="fa-solid fa-desktop"></i><span>Share</span>';
  shareBtn.style.color = '';
  
  localVideo.srcObject = localStream;
  const videoTrack = localStream.getVideoTracks()[0];

  for (const peerId in peers) {
    const pc = peers[peerId];
    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender) sender.replaceTrack(videoTrack);
  }
}

// ========================
// PHASE 3 & 4 FEATURES
// ========================

// RECORDING
recordBtn.onclick = async () => {
  if (!isRecording) {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunks.push(e.data);
      };
      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = `Meeting_Recording_${new Date().getTime()}.webm`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        recordedChunks = [];
      };
      mediaRecorder.start();
      isRecording = true;
      recordBtn.innerHTML = '<i class="fa-solid fa-stop"></i>';
      recordBtn.classList.add('active-off');
      stream.getVideoTracks()[0].onended = () => {
        if (isRecording) stopRecording();
      };
    } catch (err) {
      console.error("Recording failed", err);
    }
  } else {
    stopRecording();
  }
};

function stopRecording() {
  if (!isRecording) return;
  mediaRecorder.stop();
  mediaRecorder.stream.getTracks().forEach(t => t.stop());
  isRecording = false;
  recordBtn.innerHTML = '<i class="fa-solid fa-record-vinyl"></i>';
  recordBtn.classList.remove('active-off');
}

// WHITEBOARD
function resizeCanvas() {
  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
}
window.addEventListener('resize', resizeCanvas);

whiteboardBtn.onclick = () => {
  isWhiteboardActive = !isWhiteboardActive;
  if (isWhiteboardActive) {
    canvas.style.display = 'block';
    resizeCanvas();
    whiteboardBtn.innerHTML = '<i class="fa-solid fa-times"></i>';
    whiteboardBtn.style.color = 'var(--primary)';
  } else {
    canvas.style.display = 'none';
    whiteboardBtn.innerHTML = '<i class="fa-solid fa-chalkboard"></i>';
    whiteboardBtn.style.color = '';
  }
};

canvas.addEventListener('mousedown', (e) => {
  isDrawing = true;
  const rect = canvas.getBoundingClientRect();
  currentPos.x = e.clientX - rect.left;
  currentPos.y = e.clientY - rect.top;
});
canvas.addEventListener('mouseup', () => { isDrawing = false; });
canvas.addEventListener('mouseout', () => { isDrawing = false; });
canvas.addEventListener('mousemove', (e) => {
  if (!isDrawing) return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  drawLine(currentPos.x, currentPos.y, x, y, '#3b82f6', true); // Blue drawing
  currentPos.x = x; currentPos.y = y;
});

function drawLine(x0, y0, x1, y1, color, emit) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.closePath();

  if (!emit || !currentRoom) return;
  
  socket.emit('draw-line', {
    roomId: currentRoom,
    x0: x0 / canvas.width,
    y0: y0 / canvas.height,
    x1: x1 / canvas.width,
    y1: y1 / canvas.height,
    color
  });
}

socket.on('draw-line', (data) => {
  if(canvas.width === 0) resizeCanvas();
  drawLine(data.x0 * canvas.width, data.y0 * canvas.height, data.x1 * canvas.width, data.y1 * canvas.height, data.color, false);
});

// LIVE CAPTIONS
if ('webkitSpeechRecognition' in window) {
  recognition = new webkitSpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  
  recognition.onresult = (event) => {
    let finalTranscript = '';
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        finalTranscript += event.results[i][0].transcript;
      }
    }
    if (finalTranscript.trim().length > 0) {
      showCaption(userName, finalTranscript);
      if (currentRoom) {
        socket.emit('caption-text', { roomId: currentRoom, name: userName, text: finalTranscript });
      }
    }
  };
  recognition.onerror = (e) => console.error(e);
}

captionsBtn.onclick = () => {
  if (!recognition) return alert('Speech Recognition not supported in this browser (Use Chrome/Edge).');
  isCaptionsActive = !isCaptionsActive;
  if (isCaptionsActive) {
    recognition.start();
    captionsBtn.innerHTML = '<i class="fa-solid fa-closed-captioning"></i>';
    captionsBtn.style.color = 'var(--primary)';
  } else {
    recognition.stop();
    captionsBtn.innerHTML = '<i class="fa-solid fa-closed-captioning"></i>';
    captionsBtn.style.color = '';
  }
};

function showCaption(name, text) {
  const line = document.createElement('div');
  line.className = 'caption-line';
  line.innerHTML = `<span class="caption-speaker">${name}:</span> ${text}`;
  captionsContainer.appendChild(line);
  setTimeout(() => {
    line.style.opacity = '0';
    line.style.transition = 'opacity 0.5s ease';
    setTimeout(() => line.remove(), 500);
  }, 5000); // 5 seconds display
}

socket.on('caption-text', (data) => {
  // Always show captions if others are speaking, or maybe only if I enabled it?
  // Let's only show if I have it enabled, or just show universally for demo.
  // Actually, standard is you toggle captions locally.
  if (isCaptionsActive) {
    showCaption(data.name, data.text);
  }
});

// AI SUMMARY - Get button
const getSummaryBtn = document.getElementById('getSummaryBtn');
if (getSummaryBtn) {
  getSummaryBtn.onclick = () => {
    summaryContent.innerHTML = '<div style="text-align:center; padding: 2rem;"><i class="fa-solid fa-spinner fa-spin"></i> Generating summary...</div>';
    socket.emit('get-summary', { roomId: currentRoom }, (response) => {
      let html = response.summary
        .replace(/### (.*)/g, '<h3 style="color: var(--text-main); margin-bottom: 0.5rem; margin-top: 1rem;">$1</h3>')
        .replace(/\*\*(.*?)\*\*/g, '<strong style="color: var(--text-main);">$1</strong>')
        .replace(/\n/g, '<br/>');
      summaryContent.innerHTML = html;
    });
  };
}

// AI SUMMARY panel toggle
summaryBtn.addEventListener('click', () => {
  const summaryPanel = document.getElementById('summaryPanel');
  summaryPanel.classList.toggle('active');
  document.getElementById('chatPanel').classList.remove('active');
  document.getElementById('participantsPanel').classList.remove('active');
});


downloadSummaryBtn.onclick = () => {
  const text = summaryContent.innerText.trim();
  if (!text || text.length < 5) return alert('No notes to download yet. Generate an AI Summary first.');
  const timestamp = new Date().toLocaleString().replace(/[/:, ]/g, '_');
  const blob = new Blob([`Meeting Notes - Room: ${currentRoom}\nDate: ${new Date().toLocaleString()}\n\n${text}`], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `MeetupNotes_${currentRoom}_${timestamp}.txt`;
  a.click();
  URL.revokeObjectURL(url);
};

attendanceBtn.onclick = () => {
  infoModal.classList.remove('hidden');
  infoModalTitle.innerHTML = '<i class="fa-solid fa-user-check"></i> Attendance Report';
  infoModalContent.innerHTML = '<div style="text-align:center; padding: 2rem;"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</div>';
  
  socket.emit('get-attendance', { roomId: currentRoom }, (res) => {
    if (!res.success) {
      infoModalContent.innerHTML = `<span style="color:var(--danger)">Error: ${res.error}</span>`;
      return;
    }
    if (res.attendance.length === 0) {
      infoModalContent.innerHTML = 'No attendance records found.';
      return;
    }
    
    let html = '<table style="width:100%; border-collapse: collapse; text-align:left;">';
    html += '<tr style="border-bottom: 1px solid var(--border-light);"><th>Name</th><th>Joined</th><th>Left</th></tr>';
    res.attendance.forEach(r => {
      const formatTime = (ts) => {
        if (!ts) return 'Present';
        const d = new Date(ts + 'Z');
        return isNaN(d) ? ts : d.toLocaleTimeString();
      };
      
      html += `
        <tr style="border-bottom: 1px solid var(--border-light);">
          <td style="padding: 0.5rem 0;">${r.user_name || 'Guest'}</td>
          <td style="padding: 0.5rem 0;">${formatTime(r.joined_at)}</td>
          <td style="padding: 0.5rem 0;">${formatTime(r.left_at)}</td>
        </tr>
      `;
    });
    html += '</table>';
    infoModalContent.innerHTML = html;
  });
};

closeInfoModalBtn.onclick = () => { infoModal.classList.add('hidden'); };

// ========================

// Chat logic
const chatBtn = document.querySelector('.ctrl-labeled-btn[title="Chat"]');
if (chatBtn) chatBtn.onclick = () => togglePanel('chatPanel');

chatForm.onsubmit = (e) => {
  e.preventDefault();
  if (!currentRoom) return;
  const message = chatInput.value.trim();
  if (!message) return;

  const data = {
    roomId: currentRoom,
    message,
    name: userName,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };
  
  socket.emit('chat-message', data);
  appendMessage(data, true);
  chatInput.value = '';
};

function appendMessage(data, isSelf) {
  const msgEl = document.createElement('div');
  msgEl.className = `chat-message ${isSelf ? 'self' : ''}`;
  
  msgEl.innerHTML = `
    <div class="chat-message-meta">
      <span>${isSelf ? 'You' : data.name}</span>
      <span>${data.timestamp}</span>
    </div>
    <div class="chat-message-bubble">${data.message}</div>
  `;
  
  chatMessages.appendChild(msgEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Socket signaling events
socket.on('peer-joined', ({ peer }) => {
  participants.set(peer.id, peer);
  // Add toast notification for join
  showToast(`${peer.name} joined the meeting`);
  playChime('join');
  renderParticipants();
  
  createPeerConnection(peer.id, true).then(async (pc) => {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('signal', { to: peer.id, from: socket.id, signal: { type: 'offer', sdp: offer } });
  });
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

socket.on('chat-message', (data) => {
  appendMessage(data, false);
});

socket.on('media-state-changed', ({ peerId, isMuted, isVideoOff }) => {
  const peer = participants.get(peerId);
  if (peer) {
    peer.isMuted = isMuted;
    peer.isVideoOff = isVideoOff;
  }
  
  const muteIcon = document.getElementById('mute-icon-' + peerId);
  if (muteIcon) muteIcon.style.display = isMuted ? 'inline-block' : 'none';
  
  const videoOffOverlay = document.getElementById('video-off-' + peerId);
  if (videoOffOverlay) videoOffOverlay.style.display = isVideoOff ? 'flex' : 'none';
});

socket.on('peer-left', ({ peerId }) => {
  const wrapper = document.getElementById('wrapper-' + peerId);
  if (wrapper) wrapper.remove();
  
  participants.delete(peerId);
  renderParticipants();
  
  const pc = peers[peerId];
  if (pc) {
    pc.close();
    delete peers[peerId];
  }
});

socket.on('screen-share-status', ({ peerId, isSharing }) => {
  const wrapper = document.getElementById('wrapper-' + peerId);
  const peersContainerWrapper = document.getElementById('peers');
  const peer = participants.get(peerId);
  if (peer) {
    peer.isSharingScreen = isSharing;
  }
  
  if (wrapper) {
    if (isSharing) {
      wrapper.classList.add('spotlight');
      peersContainerWrapper.classList.add('has-spotlight');
    } else {
      wrapper.classList.remove('spotlight');
      if (!peersContainerWrapper.querySelector('.spotlight')) {
        peersContainerWrapper.classList.remove('has-spotlight');
      }
    }
  }
});

// ================================================================
// NEW FEATURES BLOCK
// ================================================================

// ========================
// TOAST NOTIFICATION SYSTEM
// ========================
function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const icons = { success: 'fa-circle-check', info: 'fa-circle-info', warning: 'fa-triangle-exclamation' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<i class="fa-solid ${icons[type] || 'fa-circle-info'}"></i><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastOut 0.4s ease forwards';
    setTimeout(() => toast.remove(), 400);
  }, duration);
}

// ========================
// SOUND NOTIFICATIONS
// ========================
function playChime(type = 'join') {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  if (type === 'join') {
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
  } else {
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    osc.frequency.setValueAtTime(440, ctx.currentTime + 0.1);
  }
  gain.gain.setValueAtTime(0.2, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.4);
}

// Override peer-joined / peer-left to include sound + toast
socket.on('room-members', ({ members }) => {
  members.forEach(({ peerId, name }) => {
    if (peerId !== socket.id) {
      participants.set(peerId, { name, isMuted: false, isVideoOff: false, isSharingScreen: false });
    }
  });
  renderParticipants();
});

function onPeerJoined(peerId, name) {
  showToast(`${name} joined the meeting`, 'success');
  playChime('join');
}

function onPeerLeft(name) {
  showToast(`${name} left the meeting`, 'warning');
  playChime('leave');
}

// Hook into existing peer events
socket.on('notify-join', ({ name }) => onPeerJoined(null, name));
socket.on('notify-leave', ({ name }) => onPeerLeft(name));

// ========================
// THEME TOGGLE (Dark/Light)
// ========================
let isLightTheme = false;
const themeToggleBtn = document.getElementById('themeToggleBtn');
if (themeToggleBtn) {
  themeToggleBtn.onclick = () => {
    isLightTheme = !isLightTheme;
    document.body.classList.toggle('light-theme', isLightTheme);
    themeToggleBtn.innerHTML = isLightTheme
      ? '<i class="fa-solid fa-moon"></i>'
      : '<i class="fa-solid fa-sun"></i>';
    themeToggleBtn.title = isLightTheme ? 'Switch to Dark Mode' : 'Switch to Light Mode';
    showToast(isLightTheme ? 'Switched to Light Mode' : 'Switched to Dark Mode', 'info', 2000);
  };
}

// ========================
// LOBBY / WAITING ROOM
// ========================

window.admitGuest = (guestId) => {
  socket.emit('lobby-response', { guestId, admitted: true });
  const toast = document.getElementById(`toast-${guestId}`);
  if (toast) toast.remove();
};

window.denyGuest = (guestId) => {
  socket.emit('lobby-response', { guestId, admitted: false });
  const toast = document.getElementById(`toast-${guestId}`);
  if (toast) toast.remove();
};

socket.on('lobby-request', ({ guest }) => {
  // Show a persistent toast for the host to admit/deny
  const toastContainer = document.getElementById('toastContainer');
  if (!toastContainer) return;
  
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.id = `toast-${guest.id}`;
  toast.style.display = 'flex';
  toast.style.flexDirection = 'column';
  toast.style.gap = '0.5rem';
  toast.innerHTML = `
    <div><strong>${guest.name}</strong> wants to join the meeting.</div>
    <div style="display:flex; gap:0.5rem;">
      <button onclick="admitGuest('${guest.id}')" style="background:var(--success); color:white; border:none; padding:0.4rem 0.8rem; border-radius:8px; cursor:pointer; flex:1;"><i class="fa-solid fa-check"></i> Admit</button>
      <button onclick="denyGuest('${guest.id}')" style="background:var(--danger); color:white; border:none; padding:0.4rem 0.8rem; border-radius:8px; cursor:pointer; flex:1;"><i class="fa-solid fa-xmark"></i> Deny</button>
    </div>
  `;
  
  // Do not auto-remove this toast; wait for host action
  toastContainer.appendChild(toast);
  playChime('join');
});

// ========================
// HAND RAISE
// ========================
let handRaised = false;
const handRaiseBtn = document.getElementById('handRaiseBtn');
if (handRaiseBtn) {
  handRaiseBtn.onclick = () => {
    handRaised = !handRaised;
    socket.emit('hand-raise', { roomId: currentRoom, isRaised: handRaised, name: userName });
    handRaiseBtn.innerHTML = handRaised ? '<i class="fa-solid fa-hand"></i><span>Lower Hand</span>' : '<i class="fa-solid fa-hand"></i><span>Raise Hand</span>';
    if (handRaised) {
      handRaiseBtn.classList.add('active-off');
      handRaiseBtn.style.background = '#f59e0b';
      showToast('You raised your hand ✋', 'info', 2000);
    } else {
      handRaiseBtn.classList.remove('active-off');
      handRaiseBtn.style.background = '';
    }
  };
}

socket.on('hand-raise', ({ name, isRaised, peerId }) => {
  const wrapper = document.getElementById('wrapper-' + peerId);
  if (wrapper) {
    let badge = wrapper.querySelector('.hand-raise-badge');
    if (isRaised) {
      if (!badge) {
        badge = document.createElement('div');
        badge.className = 'hand-raise-badge';
        badge.textContent = '✋';
        wrapper.appendChild(badge);
      }
    } else {
      if (badge) badge.remove();
    }
  }
  if (isRaised) {
    showToast(`${name} raised their hand ✋`, 'info');
  }
});

// ========================
// AI NOISE CANCELLATION (Noise Gate)
// ========================
let isNoiseGateActive = false;
let audioContextGate, mediaStreamSourceGate, scriptNodeGate, mediaStreamDestGate;
const noiseGateBtn = document.getElementById('noiseGateBtn');

if (noiseGateBtn) {
  noiseGateBtn.onclick = () => {
    if (!localStream) return;
    isNoiseGateActive = !isNoiseGateActive;
    if (isNoiseGateActive) {
      noiseGateBtn.classList.add('active-off');
      noiseGateBtn.style.color = 'var(--primary)';
      showToast('AI Noise Cancellation enabled', 'success', 2000);
      startNoiseGate();
    } else {
      noiseGateBtn.classList.remove('active-off');
      noiseGateBtn.style.color = '';
      stopNoiseGate();
      showToast('Noise Cancellation disabled', 'info', 2000);
    }
  };
}

function startNoiseGate() {
  if (!localStream) return;
  const audioTrack = localStream.getAudioTracks()[0];
  if (!audioTrack) return;
  
  if (!audioContextGate) {
    audioContextGate = new (window.AudioContext || window.webkitAudioContext)();
  }
  
  mediaStreamSourceGate = audioContextGate.createMediaStreamSource(localStream);
  scriptNodeGate = audioContextGate.createScriptProcessor(4096, 1, 1);
  mediaStreamDestGate = audioContextGate.createMediaStreamDestination();
  
  const THRESHOLD = 0.02; // strict gate threshold
  
  scriptNodeGate.onaudioprocess = (e) => {
    const inputData = e.inputBuffer.getChannelData(0);
    const outputData = e.outputBuffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
    const rms = Math.sqrt(sum / inputData.length);
    const gain = rms < THRESHOLD ? 0 : 1;
    for (let i = 0; i < inputData.length; i++) outputData[i] = inputData[i] * gain;
  };
  
  mediaStreamSourceGate.connect(scriptNodeGate);
  scriptNodeGate.connect(mediaStreamDestGate);
  
  const processedTrack = mediaStreamDestGate.stream.getAudioTracks()[0];
  for (const peerId in peers) {
    const pc = peers[peerId];
    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
    if (sender) sender.replaceTrack(processedTrack);
  }
}

function stopNoiseGate() {
  if (scriptNodeGate) scriptNodeGate.disconnect();
  if (mediaStreamSourceGate) mediaStreamSourceGate.disconnect();
  
  const audioTrack = localStream.getAudioTracks()[0];
  for (const peerId in peers) {
    const pc = peers[peerId];
    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
    if (sender && audioTrack) sender.replaceTrack(audioTrack);
  }
}

// ========================
// VIRTUAL BACKGROUND BLUR
// ========================
let isBlurActive = false;
let blurCanvas, blurCtx, blurInterval;
const blurBtn = document.getElementById('blurBtn');

if (blurBtn) {
  blurBtn.onclick = async () => {
    if (!localStream) return;
    isBlurActive = !isBlurActive;
    if (isBlurActive) {
      blurBtn.classList.add('active-off');
      blurBtn.style.background = 'var(--primary)';
      showToast('Background blur enabled', 'success', 2000);
      startBlur();
    } else {
      blurBtn.classList.remove('active-off');
      blurBtn.style.background = '';
      stopBlur();
      showToast('Background blur disabled', 'info', 2000);
    }
  };
}

function startBlur() {
  if (!blurCanvas) {
    blurCanvas = document.createElement('canvas');
    blurCanvas.width = 640; blurCanvas.height = 360;
    blurCtx = blurCanvas.getContext('2d');
  }
  const videoEl = localVideo;
  blurInterval = setInterval(() => {
    if (!videoEl.videoWidth) return;
    blurCtx.filter = 'blur(12px)';
    blurCtx.drawImage(videoEl, 0, 0, blurCanvas.width, blurCanvas.height);
  }, 33);
  try {
    const blurStream = blurCanvas.captureStream(30);
    const blurTrack = blurStream.getVideoTracks()[0];
    localVideo.srcObject = blurStream;
    for (const peerId in peers) {
      const pc = peers[peerId];
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) sender.replaceTrack(blurTrack);
    }
  } catch(e) { console.warn('Blur not supported', e); }
}

function stopBlur() {
  if (blurInterval) clearInterval(blurInterval);
  if (localStream) {
    localVideo.srcObject = localStream;
    const videoTrack = localStream.getVideoTracks()[0];
    for (const peerId in peers) {
      const pc = peers[peerId];
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender && videoTrack) sender.replaceTrack(videoTrack);
    }
  }
}

// ========================
// LIVE TRANSCRIPT PANEL
// ========================
const transcriptBtn = document.getElementById('transcriptBtn');
let fullTranscript = [];

if (transcriptBtn) {
  transcriptBtn.onclick = () => togglePanel('transcriptPanel');
}

function addTranscriptLine(speaker, text) {
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  fullTranscript.push({ speaker, text, time });
  const container = document.getElementById('transcriptContent');
  if (!container) return;
  const line = document.createElement('div');
  line.className = 'transcript-line';
  // simple action-item keyword detection
  const isAction = /\b(will|should|needs? to|action|todo|by (monday|tuesday|wednesday|thursday|friday|tomorrow)|assign|complete|finish|send|review)\b/i.test(text);
  line.innerHTML = `<span class="transcript-time">${time}</span><span class="transcript-speaker">${speaker}:</span>${text}${isAction ? '<span class="action-item-tag">Action</span>' : ''}`;
  container.appendChild(line);
  container.scrollTop = container.scrollHeight;
}

// Hook into captions to also feed transcript
socket.on('caption', (data) => {
  addTranscriptLine(data.name, data.text);
});

// Auto Action Items extractor
const autoActionsBtn = document.getElementById('autoActionsBtn');
if (autoActionsBtn) {
  autoActionsBtn.onclick = () => {
    const actions = fullTranscript.filter(({ text }) =>
      /\b(will|should|needs? to|action|todo|by (monday|tuesday|wednesday|thursday|friday|tomorrow)|assign|complete|finish|send|review)\b/i.test(text)
    );
    if (actions.length === 0) { showToast('No action items detected yet. Enable captions first!', 'warning'); return; }
    infoModal.classList.remove('hidden');
    infoModalTitle.innerHTML = '<i class="fa-solid fa-list-check"></i> Auto-Detected Action Items';
    infoModalContent.innerHTML = `<ul style="list-style:none;padding:0;display:flex;flex-direction:column;gap:0.75rem;">${
      actions.map(a => `<li style="padding:0.75rem;background:#fef3c7;border-radius:8px;display:flex;gap:0.75rem;align-items:flex-start;">
        <i class="fa-solid fa-circle-check" style="color:#92400e;margin-top:2px;"></i>
        <div><div style="font-weight:600;font-size:0.85rem;color:#92400e;">${a.speaker}</div><div>${a.text}</div></div>
      </li>`).join('')
    }</ul>`;
  };
}

// ========================
// MEETING AGENDA
// ========================
let agendaItems = [];
const agendaBtn = document.getElementById('agendaBtn');
const agendaAddBtn = document.getElementById('agendaAddBtn');
const agendaInput = document.getElementById('agendaInput');

if (agendaBtn) {
  agendaBtn.onclick = () => togglePanel('agendaPanel');
}

function renderAgenda() {
  const list = document.getElementById('agendaList');
  if (!list) return;
  if (agendaItems.length === 0) {
    list.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem;font-size:0.9rem;">No agenda items yet. Add one below!</p>';
    return;
  }
  list.innerHTML = agendaItems.map((item, i) => `
    <div class="agenda-item">
      <input type="checkbox" ${item.done ? 'checked' : ''} onchange="toggleAgendaItem(${i})" />
      <span class="agenda-item-text ${item.done ? 'done' : ''}">${item.text}</span>
      <button onclick="removeAgendaItem(${i})" style="background:none;border:none;cursor:pointer;color:var(--text-muted);"><i class="fa-solid fa-trash"></i></button>
    </div>
  `).join('');
}

function toggleAgendaItem(i) { agendaItems[i].done = !agendaItems[i].done; renderAgenda(); }
function removeAgendaItem(i) { agendaItems.splice(i, 1); renderAgenda(); }

if (agendaAddBtn && agendaInput) {
  agendaAddBtn.onclick = () => {
    const text = agendaInput.value.trim();
    if (!text) return;
    agendaItems.push({ text, done: false });
    agendaInput.value = '';
    renderAgenda();
  };
  agendaInput.addEventListener('keydown', e => { if (e.key === 'Enter') agendaAddBtn.click(); });
}
renderAgenda();

// ========================
// FULLSCREEN VIDEO (double-click)
// ========================
peersContainer.addEventListener('dblclick', (e) => {
  const wrapper = e.target.closest('.video-wrapper');
  if (!wrapper) return;
  if (wrapper.classList.contains('fullscreen-mode')) {
    wrapper.classList.remove('fullscreen-mode');
  } else {
    document.querySelectorAll('.video-wrapper.fullscreen-mode').forEach(w => w.classList.remove('fullscreen-mode'));
    wrapper.classList.add('fullscreen-mode');
    showToast('Double-click again to exit fullscreen', 'info', 2500);
  }
});

// ESC to exit fullscreen
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.video-wrapper.fullscreen-mode').forEach(w => w.classList.remove('fullscreen-mode'));
  }
});

// ========================
// WIRE UP NEW PANEL BUTTONS
// ========================
const allPanels = ['chatPanel','transcriptPanel','participantsPanel','agendaPanel','codePanel','pollsPanel','summaryPanel'];

function togglePanel(panelId) {
  const panel = document.getElementById(panelId);
  allPanels.forEach(id => {
    if (id !== panelId) document.getElementById(id)?.classList.remove('active');
  });
  panel.classList.toggle('active');
}

if (summaryBtn) summaryBtn.onclick = () => togglePanel('summaryPanel');
const codeEditorBtn = document.getElementById('codeEditorBtn');
if (codeEditorBtn) codeEditorBtn.onclick = () => {
  togglePanel('codePanel');
  if (window.monacoEditor) {
    setTimeout(() => window.monacoEditor.layout(), 300); // Fix layout after sliding in
  }
};
const pollsBtn = document.getElementById('pollsBtn');
if (pollsBtn) pollsBtn.onclick = () => togglePanel('pollsPanel');

// ========================
// SHARED CODE EDITOR (MONACO)
// ========================
let isCodeSyncing = false;
window.MonacoEnvironment = {
  getWorkerUrl: function (workerId, label) {
    return `data:text/javascript;charset=utf-8,${encodeURIComponent(`
      self.MonacoEnvironment = { baseUrl: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.38.0/min/' };
      importScripts('https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.38.0/min/vs/base/worker/workerMain.js');`
    )}`;
  }
};
window.addEventListener('load', () => {
  // We loaded requirejs in index.html
  if (window.require) {
    window.require(['vs/editor/editor.main'], function() {
      window.monacoEditor = monaco.editor.create(document.getElementById('monacoEditorContainer'), {
        value: '// Start coding here...\n',
        language: 'javascript',
        theme: 'vs-dark',
        automaticLayout: true
      });
      
      window.monacoEditor.onDidChangeModelContent(() => {
        if (isCodeSyncing) return; // Prevent loop
        socket.emit('code-update', { roomId: currentRoom, code: window.monacoEditor.getValue() });
      });
    });
  }
});

socket.on('code-update', ({ code }) => {
  if (window.monacoEditor && window.monacoEditor.getValue() !== code) {
    isCodeSyncing = true;
    const position = window.monacoEditor.getPosition();
    window.monacoEditor.setValue(code);
    window.monacoEditor.setPosition(position);
    isCodeSyncing = false;
  }
});

// ========================
// MORE MENU TOGGLE
// ========================
const moreBtn = document.getElementById('moreBtn');
const moreMenu = document.getElementById('moreMenu');
if (moreBtn && moreMenu) {
  moreBtn.onclick = (e) => {
    e.stopPropagation();
    moreMenu.classList.toggle('hidden');
    moreBtn.classList.toggle('active-on', !moreMenu.classList.contains('hidden'));
  };
  // Close when clicking outside
  document.addEventListener('click', (e) => {
    if (!moreMenu.contains(e.target) && e.target !== moreBtn) {
      moreMenu.classList.add('hidden');
      moreBtn.classList.remove('active-on');
    }
  });
  // Close menu after clicking any item inside it
  moreMenu.querySelectorAll('.more-menu-item').forEach(item => {
    item.addEventListener('click', () => {
      moreMenu.classList.add('hidden');
      moreBtn.classList.remove('active-on');
    });
  });
}

// ========================
// LIVE POLLING
// ========================
const createPollBtn = document.getElementById('createPollBtn');
const pollsContent = document.getElementById('pollsContent');

if (createPollBtn) {
  createPollBtn.onclick = () => {
    const q = document.getElementById('pollQuestion').value.trim();
    const o1 = document.getElementById('pollOpt1').value.trim();
    const o2 = document.getElementById('pollOpt2').value.trim();
    if (!q || !o1 || !o2) return alert('Please fill in the question and at least 2 options.');
    
    socket.emit('poll-create', { roomId: currentRoom, question: q, options: [o1, o2] });
    
    document.getElementById('pollQuestion').value = '';
    document.getElementById('pollOpt1').value = '';
    document.getElementById('pollOpt2').value = '';
    showToast('Poll created successfully!', 'success');
  };
}

function renderPoll(question, options, results = null, hasVoted = false, totalVotes = 0) {
  if (!pollsContent) return;
  let html = `<div style="background:var(--bg-light); padding:1rem; border-radius:8px; border:1px solid var(--border-light);">
    <h3 style="margin-bottom:1rem; font-size:1rem;">${question}</h3>
  `;
  
  options.forEach((opt, idx) => {
    if (results && hasVoted) {
      const res = results.find(r => r.text === opt) || { votes: 0, percentage: 0 };
      html += `
        <div style="margin-bottom:0.75rem;">
          <div style="display:flex; justify-content:space-between; font-size:0.85rem; margin-bottom:0.25rem;">
            <span>${opt}</span>
            <span>${res.percentage}% (${res.votes})</span>
          </div>
          <div style="width:100%; height:8px; background:var(--border-light); border-radius:4px; overflow:hidden;">
            <div style="height:100%; width:${res.percentage}%; background:var(--primary); transition:width 0.3s ease;"></div>
          </div>
        </div>
      `;
    } else {
      html += `
        <button onclick="votePoll(${idx})" style="width:100%; text-align:left; padding:0.75rem; margin-bottom:0.5rem; background:rgba(255,255,255,0.05); border:1px solid var(--border-light); border-radius:6px; color:white; cursor:pointer; transition:background 0.2s;">
          ${opt}
        </button>
      `;
    }
  });
  
  if (results && hasVoted) {
    html += `<div style="text-align:right; font-size:0.8rem; color:var(--text-muted); margin-top:0.5rem;">${totalVotes} total votes</div>`;
  }
  
  html += `</div>`;
  pollsContent.innerHTML = html;
}

let iHaveVoted = false;

window.votePoll = (idx) => {
  iHaveVoted = true;
  socket.emit('poll-vote', { roomId: currentRoom, optionIndex: idx });
};

socket.on('poll-started', (data) => {
  // Save current poll state for update event
  window.currentPollState = data;
  iHaveVoted = data.hasVoted || false;
  renderPoll(data.question, data.options, data.existingResults, iHaveVoted, data.totalVotes);
  
  const btn = document.getElementById('pollsBtn');
  if (btn && !document.getElementById('pollsPanel').classList.contains('active')) {
    btn.style.animation = 'speakPulse 1s infinite';
    setTimeout(() => btn.style.animation = '', 5000);
    showToast('New Live Poll started!', 'info');
  }
});

socket.on('poll-updated', (data) => {
  if (window.currentPollState) {
    renderPoll(window.currentPollState.question, window.currentPollState.options, data.results, iHaveVoted, data.totalVotes);
  }
});
