// Pre-game entry flow: landing → sign in/up → lobby (create or join a game).
import { useState, type FormEvent } from 'react';
import { useNet } from '../../net/useNet';
import { COLORS } from '../../three/coords';

function Shell({ children }: { children: React.ReactNode }) {
  const status = useNet((s) => s.status);
  const notice = useNet((s) => s.notice);
  return (
    <div className="entry">
      <div className="entry-bg" />
      <div className="entry-inner">
        <div className="entry-title">MageStone</div>
        {children}
        {notice && <div className="entry-notice">{notice}</div>}
        <div className="entry-status">
          server: {status === 'online' ? 'connected' : status}
        </div>
      </div>
    </div>
  );
}

function Landing() {
  const goAuth = useNet((s) => s.goAuth);
  const playLocal = useNet((s) => s.playLocal);
  return (
    <Shell>
      <div className="entry-tag">Magical chess with dice</div>
      <div className="entry-actions">
        <button className="primary lg" onClick={() => goAuth('signin')}>
          Sign In
        </button>
        <button className="ghost lg" onClick={() => goAuth('signup')}>
          Sign Up
        </button>
      </div>
      <button className="link-btn" onClick={playLocal}>
        or play locally (hot-seat) →
      </button>
    </Shell>
  );
}

function Auth() {
  const mode = useNet((s) => s.authMode);
  const signin = useNet((s) => s.signin);
  const signup = useNet((s) => s.signup);
  const setScreen = useNet((s) => s.setScreen);
  const error = useNet((s) => s.authError);
  const busy = useNet((s) => s.authBusy);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    (mode === 'signup' ? signup : signin)(username.trim(), password);
  };

  return (
    <Shell>
      <form className="entry-card" onSubmit={submit}>
        <div className="entry-card-title">{mode === 'signup' ? 'Create account' : 'Sign in'}</div>
        <label className="entry-field">
          <span>Username</span>
          <input
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            maxLength={20}
          />
        </label>
        <label className="entry-field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          />
        </label>
        {error && <div className="entry-error">{error}</div>}
        <button className="primary lg" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
        </button>
        <div className="entry-switch">
          {mode === 'signup' ? (
            <>
              Already have an account?{' '}
              <button type="button" className="link-btn" onClick={() => useNet.setState({ authMode: 'signin', authError: null })}>
                Sign in
              </button>
            </>
          ) : (
            <>
              New here?{' '}
              <button type="button" className="link-btn" onClick={() => useNet.setState({ authMode: 'signup', authError: null })}>
                Create an account
              </button>
            </>
          )}
        </div>
        <button type="button" className="link-btn back" onClick={() => setScreen('landing')}>
          ← Back
        </button>
      </form>
    </Shell>
  );
}

function CreateJoin() {
  const username = useNet((s) => s.username);
  const create = useNet((s) => s.createGame);
  const join = useNet((s) => s.joinGame);
  const signout = useNet((s) => s.signout);
  const joinError = useNet((s) => s.joinError);
  const [players, setPlayers] = useState(2);
  const [createPw, setCreatePw] = useState('');
  const [joinId, setJoinId] = useState('');
  const [joinPw, setJoinPw] = useState('');

  return (
    <Shell>
      <div className="entry-userbar">
        Signed in as <strong>{username}</strong>
        <button className="link-btn" onClick={signout}>
          Sign out
        </button>
      </div>
      <div className="lobby-grid">
        <div className="entry-card">
          <div className="entry-card-title">Create a game</div>
          <div className="entry-field">
            <span>Players</span>
            <div className="seg-row">
              {[2, 3, 4].map((n) => (
                <button
                  key={n}
                  className={`seg ${players === n ? 'on' : ''}`}
                  onClick={() => setPlayers(n)}
                  type="button"
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <label className="entry-field">
            <span>Game password</span>
            <input value={createPw} onChange={(e) => setCreatePw(e.target.value)} placeholder="players need this to join" />
          </label>
          <button className="primary lg" onClick={() => create(players, createPw)}>
            Create game
          </button>
        </div>

        <div className="entry-card">
          <div className="entry-card-title">Join a game</div>
          <label className="entry-field">
            <span>Game ID</span>
            <input
              value={joinId}
              onChange={(e) => setJoinId(e.target.value.toUpperCase())}
              placeholder="e.g. 7KQ2P"
              maxLength={5}
            />
          </label>
          <label className="entry-field">
            <span>Password</span>
            <input value={joinPw} onChange={(e) => setJoinPw(e.target.value)} />
          </label>
          {joinError && <div className="entry-error">{joinError}</div>}
          <button className="ghost lg" onClick={() => join(joinId, joinPw)}>
            Join game
          </button>
        </div>
      </div>
    </Shell>
  );
}

function Room() {
  const room = useNet((s) => s.room)!;
  const username = useNet((s) => s.username);
  const startGame = useNet((s) => s.startGame);
  const leaveRoom = useNet((s) => s.leaveRoom);
  const isHost = room.host === username;
  const full = room.players.length >= room.playerCount;

  return (
    <Shell>
      <div className="entry-card wide">
        <div className="entry-card-title">Game lobby</div>
        <div className="room-id">
          Game ID <span className="room-code">{room.gameId}</span>
          <span className="room-hint">share this + the password</span>
        </div>
        <div className="room-players">
          {Array.from({ length: room.playerCount }).map((_, i) => {
            const p = room.players[i];
            return (
              <div key={i} className={`room-slot ${p ? 'filled' : ''}`}>
                <span className="room-dot" style={{ background: p ? COLORS[p.color] : 'transparent' }} />
                {p ? (
                  <span className="room-name">
                    {p.username}
                    {p.username === username ? ' (you)' : ''}
                    {p.username === room.host ? ' · host' : ''}
                  </span>
                ) : (
                  <span className="room-empty">waiting for a player…</span>
                )}
              </div>
            );
          })}
        </div>
        {isHost ? (
          <button className="primary lg" onClick={startGame} disabled={!full}>
            {full ? 'Start game' : `Waiting (${room.players.length}/${room.playerCount})`}
          </button>
        ) : (
          <div className="entry-waiting">Waiting for the host to start…</div>
        )}
        <button className="link-btn back" onClick={leaveRoom}>
          ← Leave lobby
        </button>
      </div>
    </Shell>
  );
}

export function EntryScreens() {
  const screen = useNet((s) => s.screen);
  const room = useNet((s) => s.room);
  if (screen === 'landing') return <Landing />;
  if (screen === 'auth') return <Auth />;
  // lobby
  return room ? <Room /> : <CreateJoin />;
}
