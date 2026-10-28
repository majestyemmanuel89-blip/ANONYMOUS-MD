import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
    Activity, ArrowDownToLine, ArrowRight, Bot, Check, ChevronDown, CircleHelp,
    Copy, Cpu, Database, Film, Gauge, Home, LayoutDashboard, Link2, LoaderCircle,
    LockKeyhole, LogOut, Menu,
    MonitorCog, MoreHorizontal, Radio, RefreshCw, Search, Server, Settings2,
    Shield, Smartphone, Terminal, Trash2, Video, Wifi, X, Zap
} from "lucide-react";
import "./styles.css";

const countries = [
    { name: "Nigeria", code: "234", flag: "🇳🇬" },
    { name: "United States", code: "1", flag: "🇺🇸" },
    { name: "United Kingdom", code: "44", flag: "🇬🇧" },
    { name: "Ghana", code: "233", flag: "🇬🇭" },
    { name: "South Africa", code: "27", flag: "🇿🇦" },
    { name: "Kenya", code: "254", flag: "🇰🇪" },
    { name: "India", code: "91", flag: "🇮🇳" },
    { name: "Canada", code: "1", flag: "🇨🇦" },
    { name: "Australia", code: "61", flag: "🇦🇺" },
    { name: "Germany", code: "49", flag: "🇩🇪" },
    { name: "France", code: "33", flag: "🇫🇷" },
    { name: "Brazil", code: "55", flag: "🇧🇷" },
    { name: "Philippines", code: "63", flag: "🇵🇭" },
    { name: "Pakistan", code: "92", flag: "🇵🇰" },
    { name: "Indonesia", code: "62", flag: "🇮🇩" }
];

const navigation = [
    { label: "Overview", icon: LayoutDashboard, page: "overview", group: "Workspace" },
    { label: "WhatsApp Sessions", icon: Smartphone, page: "sessions" },
    { label: "Bot Settings", icon: Settings2, page: "settings", group: "Management" },
    { label: "Command Management", icon: Terminal, page: "commands" },
    { label: "Menu Customisation", icon: MonitorCog, page: "menu" },
    { label: "Menu Video Library", icon: Film, page: "videos" },
    { label: "Logs & Errors", icon: Activity, page: "logs", group: "System" },
    { label: "System Information", icon: Server, page: "system" }
];

async function request(path, { csrfToken, ...options } = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body && !(options.body instanceof FormData) && !(options.body instanceof Blob)) {
        headers.set("Content-Type", "application/json");
    }
    if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
    const response = await fetch(path, {
        credentials: "same-origin",
        ...options,
        headers
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    return data;
}

function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return "Unavailable";
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value) {
    if (!value) return "Not recorded";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleString();
}

function App() {
    const [auth, setAuth] = useState({ loaded: false, configured: false, authenticated: false });
    const [csrfToken, setCsrfToken] = useState("");
    const [authCheck, setAuthCheck] = useState(0);
    const [screen, setScreen] = useState("home");
    const [page, setPage] = useState("overview");
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const [overview, setOverview] = useState(null);
    const [overviewError, setOverviewError] = useState("");
    const [refreshing, setRefreshing] = useState(false);

    useEffect(() => {
        request("/api/auth/session")
            .then(result => {
                setAuth({ loaded: true, configured: result.configured, authenticated: result.authenticated });
                setCsrfToken(result.csrfToken || "");
            })
            .catch(error => setAuth({ loaded: true, configured: false, authenticated: false, backendUnavailable: true, error: error.message }));
    }, [authCheck]);

    const refreshOverview = useCallback(async () => {
        if (!auth.authenticated) return;
        setRefreshing(true);
        try {
            const result = await request("/api/admin/overview");
            setOverview(result);
            setOverviewError("");
        } catch (error) {
            setOverviewError(error.message);
        } finally {
            setRefreshing(false);
        }
    }, [auth.authenticated]);

    useEffect(() => {
        if (!auth.authenticated) return undefined;
        refreshOverview();
        const timer = window.setInterval(refreshOverview, 15000);
        return () => window.clearInterval(timer);
    }, [auth.authenticated, refreshOverview]);

    async function signIn(password) {
        const result = await request("/api/auth/login", {
            method: "POST",
            body: JSON.stringify({ password })
        });
        setCsrfToken(result.csrfToken);
        setAuth(current => ({ ...current, authenticated: true }));
        return result;
    }

    async function signOut() {
        try {
            await request("/api/auth/logout", { method: "POST", csrfToken });
        } finally {
            setCsrfToken("");
            setAuth(current => ({ ...current, authenticated: false }));
            setOverview(null);
            setScreen("home");
        }
    }

    if (screen === "home") {
        return <LandingScreen
            backendState={!auth.loaded ? "checking" : auth.backendUnavailable ? "unavailable" : "connected"}
            adminConfigured={auth.configured}
            onOpenAdmin={() => setScreen("admin")}
            onOpenPairing={() => setScreen("pair")}
        />;
    }

    if (screen === "pair") {
        return <PairingScreen
            auth={auth}
            csrfToken={csrfToken}
            onSignIn={signIn}
            onBack={() => setScreen("home")}
        />;
    }

    if (!auth.loaded) return <LoadingScreen />;
    if (screen === "admin" && !auth.authenticated) {
        return <LoginScreen
            configured={auth.configured}
            backendUnavailable={auth.backendUnavailable}
            onRetry={() => { setAuth({ loaded: false, configured: false, authenticated: false }); setAuthCheck(value => value + 1); }}
            onSignIn={signIn}
            onBack={() => setScreen("home")}
        />;
    }

    return (
        <div className="app-shell">
            <header className="topbar">
                <button className="brand-lockup" onClick={() => setPage("overview")} aria-label="ANONYMOUS MD home">
                    <BrandMark />
                    <span><strong>ANONYMOUS MD</strong><small>CONTROL PANEL</small></span>
                </button>
                <div className="topbar-right">
                    <span className="secure-label"><LockKeyhole size={13} /> SECURE ADMIN</span>
                    <button className="admin-pill" onClick={() => setScreen("home")}><Home size={15} /> Website</button>
                    <button className="admin-pill" onClick={signOut}><LogOut size={15} /> Sign out</button>
                    <button className="mobile-menu-button" onClick={() => setMobileNavOpen(open => !open)} aria-label="Toggle navigation">
                        {mobileNavOpen ? <X size={20} /> : <Menu size={20} />}
                    </button>
                </div>
            </header>

            <div className="layout">
                <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
                    <div className="sidebar-heading">CONTROL ROOM <span className="live-dot" /></div>
                    <nav aria-label="Admin navigation">
                        {navigation.map((item, index) => {
                            const Icon = item.icon;
                            return (
                                <React.Fragment key={item.page}>
                                    {item.group && <div className={`nav-group ${index ? "nav-group-spaced" : ""}`}>{item.group}</div>}
                                    <button
                                        className={`nav-item ${page === item.page ? "nav-item-active" : ""}`}
                                        onClick={() => { setPage(item.page); setMobileNavOpen(false); }}
                                    >
                                        <Icon size={17} strokeWidth={1.8} /><span>{item.label}</span>
                                        {page === item.page && <span className="nav-active-mark" />}
                                    </button>
                                </React.Fragment>
                            );
                        })}
                    </nav>
                    <div className="sidebar-bottom">
                        <div className="sidebar-health">
                            <span className="health-icon"><Shield size={16} /></span>
                            <span><strong>Protected session</strong><small>Admin access active</small></span>
                            <span className="green-dot" />
                        </div>
                        <div className="sidebar-version">ANONYMOUS MD <span>v{overview?.version || "—"}</span></div>
                    </div>
                </aside>

                <main className="main-content">
                    <div className="page-heading">
                        <div>
                            <div className="eyebrow"><span className="eyebrow-line" /> ANONYMOUS MD / {page.replace("-", " ").toUpperCase()}</div>
                            <h1>{pageTitle(page)}</h1>
                            <p>{pageDescription(page)}</p>
                        </div>
                        <button className="icon-button refresh-button" onClick={refreshOverview} disabled={refreshing} aria-label="Refresh backend statistics">
                            <RefreshCw size={17} className={refreshing ? "spin" : ""} />
                        </button>
                    </div>

                    {overviewError && <div className="notice notice-error"><CircleHelp size={17} /> Live backend data unavailable: {overviewError}</div>}
                    {!overview && !overviewError && <div className="notice"><LoaderCircle className="spin" size={17} /> Connecting to the bot backend…</div>}
                    {page === "overview" && <OverviewPage overview={overview} csrfToken={csrfToken} setPage={setPage} />}
                    {page === "sessions" && <SessionsPage csrfToken={csrfToken} />}
                    {page === "settings" && <SettingsPage csrfToken={csrfToken} />}
                    {page === "commands" && <CommandsPage />}
                    {page === "menu" && <MenuPage csrfToken={csrfToken} />}
                    {page === "videos" && <VideosPage csrfToken={csrfToken} />}
                    {page === "logs" && <LogsPage />}
                    {page === "system" && <SystemPage overview={overview} />}
                </main>
            </div>
        </div>
    );
}

function pageTitle(page) {
    return ({
        overview: "Control at a glance",
        sessions: "WhatsApp sessions",
        settings: "Bot settings",
        commands: "Command management",
        menu: "Menu customisation",
        videos: "Menu video library",
        logs: "Logs & errors",
        system: "System information"
    })[page] || "Control panel";
}

function pageDescription(page) {
    return ({
        overview: "Monitor your bot, request a secure pairing code, and manage connected accounts.",
        sessions: "Manage linked WhatsApp accounts or clear every saved session, including the primary account.",
        settings: "Update the live bot configuration using validated backend settings.",
        commands: "Explore the verified commands exposed by the bot's real command registry.",
        menu: "Configure the bot name and inspect the current WhatsApp menu video settings.",
        videos: "Review and select MP4 assets available to the menu system.",
        logs: "Operational log access is shown only when the backend provides it.",
        system: "Runtime and process details reported directly by the bot server."
    })[page] || "";
}

function BrandMark() {
    return <span className="brand-mark"><span /><span /><span /><i /></span>;
}

function PairingScreen({ auth, csrfToken, onSignIn, onBack }) {
    const [country, setCountry] = useState(countries[0]);
    const [localNumber, setLocalNumber] = useState("");
    const [password, setPassword] = useState("");
    const [authPrompt, setAuthPrompt] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [pairing, setPairing] = useState({ code: "", sessionId: "", status: "" });

    const normalizedPhone = useMemo(() => {
        let local = localNumber.replace(/\D/g, "");
        if (local.startsWith("0")) local = local.slice(1);
        if (country.code === "1" && local.startsWith("1") && local.length === 11) local = local.slice(1);
        return `${country.code}${local}`;
    }, [country, localNumber]);

    useEffect(() => {
        if (!pairing.sessionId || !pairing.code ||
            ["connected", "cancelled", "error", "logged-out", "disconnected", "expired"].includes(pairing.status)) return undefined;
        const poll = async () => {
            try {
                const result = await request(`/api/admin/sessions/${pairing.sessionId}`);
                const status = result.session.status;
                const terminal = ["connected", "cancelled", "error", "logged-out", "disconnected"].includes(status);
                setPairing(current => ({ ...current, status, code: terminal ? "" : current.code }));
                if (["cancelled", "error", "logged-out", "disconnected"].includes(status)) {
                    setError("This pairing attempt is no longer active. Request a new code to try again.");
                }
            } catch (requestError) {
                setError(requestError.message);
            }
        };
        poll();
        const timer = window.setInterval(poll, 3000);
        return () => window.clearInterval(timer);
    }, [pairing.sessionId, pairing.code, pairing.status]);

    async function requestCode(token) {
        setLoading(true);
        setError("");
        setPairing({ code: "", sessionId: "", status: "" });
        try {
            const result = await request("/api/admin/sessions/pair", {
                method: "POST",
                csrfToken: token,
                body: JSON.stringify({ number: normalizedPhone })
            });
            setPairing({ code: result.pairingCode, sessionId: result.sessionId, status: "connecting" });
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setLoading(false);
        }
    }

    async function submit(event) {
        event.preventDefault();
        setError("");
        if (!/^\d{7,15}$/.test(normalizedPhone)) {
            setError("Enter a valid local phone number without the country calling code.");
            return;
        }
        if (!auth.loaded) {
            setError("Still checking the bot server. Try again in a moment.");
            return;
        }
        if (auth.backendUnavailable) {
            setError("The bot backend is unavailable. Start the ANONYMOUS MD bot and try again.");
            return;
        }
        if (!auth.authenticated) {
            setAuthPrompt(true);
            return;
        }
        await requestCode(csrfToken);
    }

    async function verifyAndPair(event) {
        event.preventDefault();
        setLoading(true);
        setError("");
        try {
            const result = await onSignIn(password);
            setPassword("");
            setAuthPrompt(false);
            await requestCode(result.csrfToken);
        } catch (requestError) {
            setError(requestError.message);
            setLoading(false);
        }
    }

    return (
        <main className="pair-page">
            <header className="pair-page-header">
                <button className="brand-lockup" onClick={onBack} aria-label="Back to ANONYMOUS MD home">
                    <BrandMark />
                    <span><strong>ANONYMOUS MD</strong><small>WHATSAPP PAIRING</small></span>
                </button>
                <button className="login-back-button pair-page-back" onClick={onBack}><Home size={14} /> Back to website</button>
            </header>
            <section className="pair-page-content">
                <div className="eyebrow"><span className="eyebrow-line" /> SECURE WHATSAPP LINKING</div>
                <h1>Pair your number</h1>
                <p className="pair-page-intro">Enter the phone number for the WhatsApp account you want to link. We’ll request a real pairing code from the running bot.</p>

                <div className="pair-page-grid">
                    <section className="panel-card pair-page-card">
                        <div className="card-heading">
                            <div className="card-heading-icon"><Link2 size={18} /></div>
                            <div><span className="eyebrow">PHONE NUMBER</span><h2>Enter your number</h2></div>
                            <span className="protected-tag"><LockKeyhole size={12} /> PRIVATE</span>
                        </div>
                        <form onSubmit={authPrompt ? verifyAndPair : submit} className="pair-form">
                            <label htmlFor="pair-country-select">Country and local number</label>
                            <div className="phone-input">
                                <div className="country-select-wrap">
                                    <select id="pair-country-select" value={`${country.name}:${country.code}`} onChange={event => setCountry(countries.find(item => `${item.name}:${item.code}` === event.target.value) || countries[0])} aria-label="Country calling code">
                                        {countries.map(item => <option key={`${item.name}-${item.code}`} value={`${item.name}:${item.code}`}>{item.flag} +{item.code} · {item.name}</option>)}
                                    </select>
                                    <ChevronDown size={14} />
                                </div>
                                <input
                                    aria-label="Phone number without calling code"
                                    type="tel"
                                    inputMode="numeric"
                                    autoComplete="tel-national"
                                    placeholder="801 234 5678"
                                    value={localNumber}
                                    onChange={event => setLocalNumber(event.target.value)}
                                    required
                                />
                            </div>
                            <span className="field-hint">Enter your local number. A leading zero is removed automatically. Number sent: <b>+{normalizedPhone}</b></span>
                            {error && <div className="form-error"><CircleHelp size={15} /> {error}</div>}
                            {pairing.sessionId && (
                                <div className="pairing-result">
                                    <div><span>{pairing.status === "connected" ? "WHATSAPP SESSION CONNECTED" : pairing.code ? "WHATSAPP PAIRING CODE" : "PAIRING REQUEST ENDED"}</span>{pairing.code ? <strong>{pairing.code}</strong> : pairing.status === "connected" ? <strong>Connected</strong> : null}<small className="pairing-status">Session status: {pairing.status || "connecting"}</small></div>
                                    {pairing.code && <CopyButton text={pairing.code} label="Copy code" />}
                                    <p>{pairing.status === "connected" ? <>WhatsApp session <b>{pairing.sessionId}</b> connected successfully.</> : <>Session <b>{pairing.sessionId}</b> is waiting for you to enter this code in WhatsApp.</>}</p>
                                </div>
                            )}
                            {authPrompt && !auth.authenticated && (
                                <div className="pair-auth-box">
                                    <div className="pair-auth-heading"><LockKeyhole size={15} /><strong>Administrator verification</strong></div>
                                    {!auth.configured ? (
                                        <p>Pairing is protected. The bot administrator must configure <code>PANEL_ADMIN_PASSWORD</code> and <code>PANEL_SESSION_SECRET</code> on the bot server before a code can be requested.</p>
                                    ) : (
                                        <>
                                            <p>Sign in securely to request a real pairing code. Your phone number will stay on this page.</p>
                                            <label htmlFor="pair-admin-password">Administrator password</label>
                                            <input id="pair-admin-password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required minLength={10} />
                                        </>
                                    )}
                                </div>
                            )}
                            <button className="button button-primary button-wide" disabled={loading || !auth.loaded || !localNumber.trim()}>
                                {loading ? <LoaderCircle size={17} className="spin" /> : authPrompt ? <LockKeyhole size={16} /> : <Zap size={17} />}
                                {loading ? "Connecting securely…" : authPrompt && auth.configured ? "Verify and get pairing code" : authPrompt ? "Admin setup required" : "Get Pairing Code"}
                                {!loading && !authPrompt && <ArrowRight size={16} />}
                            </button>
                        </form>
                        <div className="instruction-box"><div className="instruction-index">01</div><div><strong>Open WhatsApp on your phone</strong><p>Go to <b>Settings</b> → <b>Linked devices</b> → <b>Link a device</b>, then choose <b>Link with phone number instead</b>.</p></div></div>
                        <div className="instruction-box"><div className="instruction-index">02</div><div><strong>Enter the one-time code</strong><p>Keep the code private and enter it only in WhatsApp. It can only be used to link your account.</p></div></div>
                        <div className="qr-note"><Shield size={14} /> No QR code is used. Pairing codes are returned only after administrator verification.</div>
                    </section>
                    <aside className="pair-page-aside">
                        <div className="pair-aside-icon"><Smartphone size={21} /></div>
                        <span className="eyebrow">BEFORE YOU CONTINUE</span>
                        <h2>Keep your account secure.</h2>
                        <ul>
                            <li>Use the full number for the account you want to link.</li>
                            <li>Never share the pairing code with anyone.</li>
                            <li>Keep the ANONYMOUS MD bot server running while you link.</li>
                        </ul>
                        <div className="pair-aside-status"><span className={`landing-api-dot ${auth.backendUnavailable ? "" : "pair-api-ready"}`} /><span>{auth.backendUnavailable ? "Bot backend unavailable" : !auth.loaded ? "Checking bot backend" : "Connected to bot backend"}</span></div>
                    </aside>
                </div>
            </section>
        </main>
    );
}

function LandingScreen({ backendState, adminConfigured, onOpenAdmin, onOpenPairing }) {
    const connectionLabel = {
        checking: "Checking bot backend",
        connected: "Control API connected",
        unavailable: "Bot backend unavailable"
    }[backendState];

    return (
        <main className="landing-page" id="top">
            <header className="landing-topbar">
                <a className="brand-lockup" href="#top" aria-label="ANONYMOUS MD home">
                    <BrandMark />
                    <span><strong>ANONYMOUS MD</strong><small>WHATSAPP CONTROL</small></span>
                </a>
                <nav className="landing-nav" aria-label="Main navigation">
                    <a href="#features">Features</a>
                    <a href="#pairing">Pair your number</a>
                </nav>
                <button className="button button-secondary landing-admin" onClick={onOpenAdmin}>
                    <Shield size={15} /> Admin
                </button>
            </header>

            <section className="landing-hero">
                <div className="landing-copy">
                    <div className="eyebrow"><span className="eyebrow-line" /> WHATSAPP CONTROL, BUILT AROUND YOU</div>
                    <h1>YOUR WHATSAPP.<br />YOUR COMMANDS.<br /><span>YOUR POWER.</span></h1>
                    <p>Manage your ANONYMOUS MD connection, link a device securely, and keep your bot controls in one place.</p>
                    <div className="landing-actions">
                        <button className="button button-primary" onClick={onOpenPairing}>Pair Your Number <ArrowRight size={16} /></button>
                        <a className="landing-secondary-link" href="#features">Explore features <ArrowDownToLine size={15} /></a>
                    </div>
                    <div className={`landing-api-state landing-api-${backendState}`} role="status">
                        <span className="landing-api-dot" />
                        <span>{connectionLabel}</span>
                        {backendState === "connected" && !adminConfigured && <small>Admin access setup required</small>}
                    </div>
                </div>

                <div className="landing-visual" aria-hidden="true">
                    <div className="landing-orbit landing-orbit-outer" />
                    <div className="landing-orbit landing-orbit-inner" />
                    <div className="landing-core"><BrandMark /></div>
                    <div className="landing-orbit-point landing-point-one" />
                    <div className="landing-orbit-point landing-point-two" />
                    <div className="landing-float-card landing-float-top"><Wifi size={15} /><span>BOT LINK</span><strong>SECURE</strong></div>
                    <div className="landing-float-card landing-float-bottom"><Terminal size={15} /><span>COMMANDS</span><strong>READY</strong></div>
                </div>
            </section>

            <section className="landing-feature-section" id="features">
                <div className="landing-section-heading">
                    <div><div className="eyebrow"><span className="eyebrow-line" /> CONTROL, WITHOUT THE CLUTTER</div><h2>Everything in its place.</h2></div>
                    <p>Connected to the existing ANONYMOUS MD bot and its session manager.</p>
                </div>
                <div className="landing-feature-grid">
                    <LandingFeature icon={Link2} title="Secure pairing" detail="Request a genuine WhatsApp linking code through the bot's Baileys connection." />
                    <LandingFeature icon={Smartphone} title="Session management" detail="Check and manage sessions through the bot's existing session lifecycle." />
                    <LandingFeature icon={Activity} title="Live overview" detail="See runtime, memory, uptime, and connection status reported by the backend." />
                    <LandingFeature icon={Settings2} title="Bot controls" detail="Review verified commands and manage supported bot settings and menu videos." />
                </div>
            </section>

            <section className="landing-pairing-strip" id="pairing">
                <div className="pairing-strip-icon"><LockKeyhole size={19} /></div>
                <div><span className="eyebrow">PRIVATE BY DESIGN</span><h2>Pair your number with confidence.</h2><p>Pairing codes and session controls are available only after secure administrator sign-in.</p></div>
                <button className="button button-primary" onClick={onOpenPairing}>Continue to pairing <ArrowRight size={16} /></button>
            </section>

            <footer className="landing-footer">
                <span>© {new Date().getFullYear()} ANONYMOUS MD</span>
                <span>Connected to the existing bot backend</span>
            </footer>
        </main>
    );
}

function LandingFeature({ icon: Icon, title, detail }) {
    return <article className="landing-feature-card">
        <span className="landing-feature-icon"><Icon size={18} /></span>
        <h3>{title}</h3>
        <p>{detail}</p>
    </article>;
}

function LoadingScreen() {
    return <div className="loading-screen"><BrandMark /><span>Connecting to ANONYMOUS MD</span></div>;
}

function LoginScreen({ configured, backendUnavailable, onRetry, onSignIn, onBack }) {
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    async function submit(event) {
        event.preventDefault();
        setLoading(true);
        setError("");
        try {
            await onSignIn(password);
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setLoading(false);
        }
    }

    return (
        <main className="login-screen">
            <div className="ambient ambient-login" />
            <div className="login-panel">
                <BrandMark />
                <div className="eyebrow"><span className="eyebrow-line" /> ANONYMOUS MD / SECURE ACCESS</div>
                <h1>Control Panel</h1>
                <p className="login-subtitle">Sign in with the administrator password configured on the bot server.</p>
                <button className="login-back-button" onClick={onBack}><Home size={14} /> Back to website</button>
                {backendUnavailable ? (
                    <div className="notice notice-warning">
                        <Server size={18} />
                        <span>The bot backend API is unavailable. Start the existing ANONYMOUS MD process and retry. The frontend does not simulate bot status or pairing.</span>
                        <button className="text-button" onClick={onRetry}>Retry <RefreshCw size={13} /></button>
                    </div>
                ) : !configured ? (
                    <div className="notice notice-warning">
                        <LockKeyhole size={18} />
                        <span>Admin access is not configured. Set <code>PANEL_ADMIN_PASSWORD</code> (10+ characters) and <code>PANEL_SESSION_SECRET</code> (32+ characters) in the server environment, then restart the bot.</span>
                    </div>
                ) : (
                    <form onSubmit={submit} className="login-form">
                        <label htmlFor="admin-password">Administrator password</label>
                        <input id="admin-password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required minLength={10} />
                        {error && <div className="form-error">{error}</div>}
                        <button className="button button-primary button-wide" disabled={loading}>
                            {loading ? <LoaderCircle className="spin" size={17} /> : <LockKeyhole size={16} />}
                            {loading ? "Authenticating…" : "Sign in securely"}
                        </button>
                        <p className="form-footnote">Protected with an HttpOnly session cookie, CSRF checks, and server-side authorization.</p>
                    </form>
                )}
            </div>
            <div className="login-footer">PRIVATE CONTROL SURFACE <span /> YOUR BOT, YOUR RULES</div>
        </main>
    );
}

function StatCard({ icon: Icon, label, value, helper, tone = "" }) {
    return (
        <div className={`stat-card ${tone}`}>
            <div className="stat-top"><span className="stat-icon"><Icon size={17} /></span><span className="stat-label">{label}</span><MoreHorizontal size={17} className="stat-more" /></div>
            <strong className="stat-value">{value ?? "Unavailable"}</strong>
            <span className="stat-helper">{helper}</span>
        </div>
    );
}

function OverviewPage({ overview, csrfToken, setPage }) {
    const [pairing, setPairing] = useState({ loading: false, code: "", sessionId: "", status: "", error: "" });
    const [country, setCountry] = useState(countries[0]);
    const [localNumber, setLocalNumber] = useState("");
    const [lookupNumber, setLookupNumber] = useState("");
    const [lookup, setLookup] = useState({ loading: false, session: null, error: "" });

    const normalizedPhone = useMemo(() => {
        let local = localNumber.replace(/\D/g, "");
        if (local.startsWith("0")) local = local.slice(1);
        if (country.code === "1" && local.startsWith("1") && local.length === 11) local = local.slice(1);
        return `${country.code}${local}`;
    }, [country, localNumber]);

    useEffect(() => {
        if (!pairing.sessionId || !pairing.code ||
            ["connected", "cancelled", "error", "logged-out", "disconnected", "expired"].includes(pairing.status)) return undefined;
        const poll = async () => {
            try {
                const result = await request(`/api/admin/sessions/${pairing.sessionId}`);
                const status = result.session.status;
                const terminal = ["connected", "cancelled", "error", "logged-out", "disconnected"].includes(status);
                setPairing(current => ({ ...current, status, code: terminal ? "" : current.code }));
                if (["cancelled", "error", "logged-out", "disconnected"].includes(status)) {
                    setPairing(current => ({
                        ...current,
                        status,
                        error: "This pairing attempt is no longer active. Request a new code to try again."
                    }));
                }
            } catch (error) {
                setPairing(current => ({ ...current, error: error.message }));
            }
        };
        poll();
        const timer = window.setInterval(poll, 3000);
        return () => window.clearInterval(timer);
    }, [pairing.sessionId, pairing.code, pairing.status]);

    async function requestPairing(event) {
        event.preventDefault();
        if (!/^\d{7,15}$/.test(normalizedPhone)) {
            setPairing({ loading: false, code: "", sessionId: "", status: "", error: "Enter a valid local phone number without the country calling code." });
            return;
        }
        setPairing({ loading: true, code: "", sessionId: "", status: "", error: "" });
        try {
            const result = await request("/api/admin/sessions/pair", {
                method: "POST",
                csrfToken,
                body: JSON.stringify({ number: normalizedPhone })
            });
            setPairing({ loading: false, code: result.pairingCode, sessionId: result.sessionId, status: "connecting", error: "" });
        } catch (error) {
            setPairing({ loading: false, code: "", sessionId: "", status: "", error: error.message });
        }
    }

    async function lookupSession(event) {
        event.preventDefault();
        setLookup({ loading: true, session: null, error: "" });
        try {
            const number = lookupNumber.replace(/\D/g, "");
            const result = await request(`/api/admin/sessions/lookup?number=${encodeURIComponent(number)}`);
            setLookup({ loading: false, session: result.session, error: "" });
        } catch (error) {
            setLookup({ loading: false, session: null, error: error.message });
        }
    }

    return (
        <>
            <div className="dashboard-columns">
                <aside className="dashboard-metrics" aria-label="Live bot statistics">
                    <div className="metrics-heading"><span className="eyebrow">LIVE STATISTICS</span><span className="live-dot" /></div>
                    <StatCard icon={Database} label="TOTAL SESSIONS" value={overview?.totalSessions ?? "—"} helper="Registered sessions" />
                    <StatCard icon={Wifi} label="ONLINE NOW" value={overview?.onlineNow ?? "—"} helper="Connected accounts" tone="stat-blue" />
                    <StatCard icon={Gauge} label="BOT UPTIME" value={overview?.uptime ?? "Unavailable"} helper="Current process runtime" />
                    <StatCard icon={Cpu} label="MEMORY USED" value={overview ? formatBytes(overview.memory?.rssBytes) : "Unavailable"} helper={overview ? `Heap ${formatBytes(overview.memory?.heapUsedBytes)}` : "Awaiting backend"} />
                    <StatCard icon={Shield} label="SYSTEM STATUS" value={overview?.status ?? "Unavailable"} helper="Primary WhatsApp link" tone={overview?.status === "connected" ? "stat-blue" : ""} />
                    <div className="metrics-footnote"><span /> Refreshes every 15 seconds{overview?.checkedAt ? ` · ${new Date(overview.checkedAt).toLocaleTimeString()}` : ""}</div>
                </aside>

                <div className="dashboard-primary">
                    {overview && overview.status !== "connected" && (
                        <div className="notice notice-warning">
                            <Radio size={16} />
                            <span>The backend is reachable, but the primary WhatsApp session is <b>{overview.status}</b>. Keep the bot process running; reconnect an existing session or request a new pairing code below.</span>
                        </div>
                    )}
                    <section className="status-banner">
                <div className="status-banner-icon"><Radio size={20} /></div>
                <div className="status-banner-copy">
                    <span>PRIMARY WHATSAPP SESSION</span>
                    <strong>{overview?.status || "Unavailable"}</strong>
                </div>
                <span className={`status-chip ${overview?.status === "connected" ? "status-online" : ""}`}><i />{overview?.status || "Unavailable"}</span>
                <span className="status-checked">{overview?.checkedAt ? `Updated ${new Date(overview.checkedAt).toLocaleTimeString()}` : "Live status unavailable"}</span>
                    </section>

                    <div className="content-grid">
                <section className="panel-card pairing-card">
                    <div className="card-heading">
                        <div className="card-heading-icon"><Link2 size={18} /></div>
                        <div><span className="eyebrow">SECURE ACCOUNT LINK</span><h2>Pair your number</h2></div>
                        <span className="protected-tag"><LockKeyhole size={12} /> PRIVATE</span>
                    </div>
                    <p className="card-intro">Link a WhatsApp account to this bot using a one-time code issued by the live Baileys connection.</p>
                    <form onSubmit={requestPairing} className="pair-form">
                        <label htmlFor="country-select">Phone number</label>
                        <div className="phone-input">
                            <div className="country-select-wrap">
                                <select id="country-select" value={`${country.name}:${country.code}`} onChange={event => setCountry(countries.find(item => `${item.name}:${item.code}` === event.target.value) || countries[0])} aria-label="Country calling code">
                                    {countries.map(item => <option key={`${item.name}-${item.code}`} value={`${item.name}:${item.code}`}>{item.flag} +{item.code} · {item.name}</option>)}
                                </select>
                                <ChevronDown size={14} />
                            </div>
                            <input
                                aria-label="Phone number without calling code"
                                type="tel"
                                inputMode="numeric"
                                autoComplete="tel-national"
                                placeholder="801 234 5678"
                                value={localNumber}
                                onChange={event => setLocalNumber(event.target.value)}
                                required
                            />
                        </div>
                        <span className="field-hint">Enter your local number. A leading zero is removed automatically. Number sent: <b>+{normalizedPhone}</b></span>
                        {pairing.error && <div className="form-error"><CircleHelp size={15} /> {pairing.error}</div>}
                        {pairing.sessionId && (
                            <div className="pairing-result">
                                <div><span>{pairing.status === "connected" ? "WHATSAPP SESSION CONNECTED" : pairing.code ? "WHATSAPP PAIRING CODE" : "PAIRING REQUEST ENDED"}</span>{pairing.code ? <strong>{pairing.code}</strong> : pairing.status === "connected" ? <strong>Connected</strong> : null}<small className="pairing-status">Session status: {pairing.status || "connecting"}</small></div>
                                {pairing.code && <CopyButton text={pairing.code} label="Copy code" />}
                                <p>{pairing.status === "connected" ? <>WhatsApp session <b>{pairing.sessionId}</b> connected successfully.</> : <>Session <b>{pairing.sessionId}</b> is waiting for you to enter this code in WhatsApp.</>}</p>
                            </div>
                        )}
                        <button className="button button-primary button-wide" disabled={pairing.loading || !localNumber.trim()}>
                            {pairing.loading ? <LoaderCircle size={17} className="spin" /> : <Zap size={17} />}
                            {pairing.loading ? "Requesting live pairing code…" : "Get Pairing Code"}
                            {!pairing.loading && <ArrowRight size={16} />}
                        </button>
                    </form>
                    <div className="instruction-box">
                        <div className="instruction-index">01</div>
                        <div><strong>Open WhatsApp on your phone</strong><p>Go to <b>Settings</b> → <b>Linked devices</b> → <b>Link a device</b>, then choose <b>Link with phone number instead</b>.</p></div>
                    </div>
                    <div className="instruction-box">
                        <div className="instruction-index">02</div>
                        <div><strong>Enter the one-time code</strong><p>Copy the code above into WhatsApp. Keep it private; it expires and can only be used to link your account.</p></div>
                    </div>
                    <div className="qr-note"><Shield size={14} /> This panel never displays a QR code. Pairing codes are returned only to an authenticated admin session.</div>
                </section>

                <section className="panel-card manage-card">
                    <div className="card-heading">
                        <div className="card-heading-icon card-heading-cyan"><Search size={18} /></div>
                        <div><span className="eyebrow">SESSION LOOKUP</span><h2>Manage my session</h2></div>
                    </div>
                    <p className="card-intro">Search using the full international phone number, including its calling code.</p>
                    <form onSubmit={lookupSession} className="lookup-form">
                        <label htmlFor="lookup-number">Full international number</label>
                        <div className="input-action">
                            <input id="lookup-number" type="tel" inputMode="numeric" placeholder="+2348012345678" value={lookupNumber} onChange={event => setLookupNumber(event.target.value)} required />
                            <button className="button button-secondary" disabled={lookup.loading}>{lookup.loading ? <LoaderCircle className="spin" size={16} /> : <Search size={16} />} Find</button>
                        </div>
                    </form>
                    {lookup.error && <div className="form-error"><CircleHelp size={15} /> {lookup.error}</div>}
                    {lookup.session && <SessionLookupResult session={lookup.session} csrfToken={csrfToken} />}
                    {!lookup.session && !lookup.error && (
                        <div className="empty-placeholder">
                            <div className="empty-icon"><Smartphone size={22} /></div>
                            <strong>Session status appears here</strong>
                            <span>Numbers are masked in the result. Session credentials never leave the bot server.</span>
                        </div>
                    )}
                    <div className="manage-footer"><button className="text-button" onClick={() => setPage("sessions")}>View all sessions <ArrowRight size={14} /></button></div>
                </section>
                    </div>

                    <section className="quick-links">
                <div><span className="eyebrow">QUICK ACCESS</span><h2>Admin workspace</h2></div>
                {[
                    { page: "sessions", icon: Smartphone, label: "WhatsApp sessions", detail: `${overview?.totalSessions ?? "—"} registered · view or delete` },
                    { page: "commands", icon: Terminal, label: "Command registry", detail: `${overview?.commandCount ?? "—"} registered` },
                    { page: "videos", icon: Video, label: "Menu videos", detail: "Review library" },
                    { page: "settings", icon: Settings2, label: "Bot settings", detail: "Configuration" }
                ].map(item => <button className="quick-link" key={item.page} onClick={() => setPage(item.page)}><span><item.icon size={17} /></span><div><strong>{item.label}</strong><small>{item.detail}</small></div><ArrowRight size={15} /></button>)}
                    </section>
                </div>
            </div>
        </>
    );
}

function SessionLookupResult({ session, csrfToken }) {
    const [currentSession, setCurrentSession] = useState(session);
    const [message, setMessage] = useState("");
    useEffect(() => setCurrentSession(session), [session]);
    async function act(action) {
        if (["logout", "remove"].includes(action) && !window.confirm(`Confirm ${action} for session ${session.id}? This action may unlink the WhatsApp account or remove its saved session.`)) return;
        setMessage("");
        try {
            await request(`/api/admin/sessions/${session.id}/${action}`, {
                method: "POST",
                csrfToken,
                body: JSON.stringify({ confirm: ["logout", "remove"].includes(action) })
            });
            setMessage(`${action[0].toUpperCase()}${action.slice(1)} request completed.`);
            if (action !== "remove") {
                const result = await request(`/api/admin/sessions/${session.id}`);
                setCurrentSession(result.session);
            }
        } catch (error) {
            setMessage(error.message);
        }
    }
    return (
        <div className="lookup-result">
            <div className="lookup-result-top"><span className={`status-chip ${currentSession.status === "connected" ? "status-online" : ""}`}><i />{currentSession.status}</span><span>{currentSession.id} · {currentSession.number}</span></div>
            <div className="lookup-detail"><small>ACCOUNT TYPE</small><strong>{currentSession.type}</strong></div>
            <div className="lookup-detail"><small>LAST CONNECTED</small><strong>{formatDate(currentSession.lastConnectedAt)}</strong></div>
            <div className="session-actions">
                <button className="button button-secondary button-small" onClick={() => act("reconnect")}><RefreshCw size={14} /> Reconnect</button>
                <button className="button button-quiet button-small" onClick={() => act("disconnect")}><X size={14} /> Disconnect</button>
            </div>
            <div className="session-actions session-destructive">
                <button className="text-button text-danger" onClick={() => act("logout")}>Log out…</button>
                <button className="text-button text-danger" onClick={() => act("remove")}>Remove session…</button>
            </div>
            {message && <div className="inline-message">{message}</div>}
        </div>
    );
}

function CopyButton({ text, label }) {
    const [copyState, setCopyState] = useState("idle");
    async function copy() {
        try {
            await navigator.clipboard.writeText(text);
            setCopyState("copied");
            window.setTimeout(() => setCopyState("idle"), 1800);
        } catch {
            setCopyState("failed");
            window.setTimeout(() => setCopyState("idle"), 2400);
        }
    }
    return <button className="button button-secondary button-small" onClick={copy} aria-label={copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : label}>
        {copyState === "copied" ? <Check size={14} /> : <Copy size={14} />}{copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : label}
    </button>;
}

function SessionsPage({ csrfToken }) {
    const [sessions, setSessions] = useState([]);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [loading, setLoading] = useState(true);
    const [clearing, setClearing] = useState(false);
    const [query, setQuery] = useState("");
    const refresh = useCallback(async () => {
        try {
            const result = await request("/api/admin/sessions");
            setSessions(result.sessions);
            setError("");
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => {
        refresh();
        const timer = window.setInterval(refresh, 12000);
        return () => window.clearInterval(timer);
    }, [refresh]);
    async function clearAll() {
        const confirmed = window.confirm(
            "Clear every WhatsApp session, including the primary bot account? This disconnects all accounts and permanently deletes their saved credentials. The primary account must be paired again after restarting the bot."
        );
        if (!confirmed) return;
        setClearing(true);
        setError("");
        setNotice("");
        try {
            const result = await request("/api/admin/sessions/clear", {
                method: "POST",
                csrfToken,
                body: JSON.stringify({ confirm: true })
            });
            setNotice(`Cleared saved credentials for ${result.clearedSessions} session(s). Restart the bot and pair the primary account again.`);
            await refresh();
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setClearing(false);
        }
    }
    const filtered = sessions.filter(session => `${session.id} ${session.number} ${session.status}`.toLowerCase().includes(query.toLowerCase()));
    return (
        <section className="panel-card">
            <div className="list-toolbar"><div><h2>Registered sessions</h2><p>Phone numbers are masked. Clearing sessions also unlinks the primary bot account.</p></div><div className="session-toolbar-actions"><button className="button button-quiet button-small text-danger" onClick={clearAll} disabled={loading || clearing || sessions.length === 0}><Trash2 size={14} />{clearing ? "Clearing…" : "Clear all sessions"}</button><div className="search-field"><Search size={16} /><input placeholder="Filter sessions…" value={query} onChange={event => setQuery(event.target.value)} /></div></div></div>
            {error && <div className="notice notice-error">{error}</div>}
            {notice && <div className="notice notice-warning"><CircleHelp size={17} />{notice}</div>}
            {loading ? <div className="notice"><LoaderCircle className="spin" size={17} /> Loading session registry…</div> : filtered.length ? (
                <div className="table-scroll"><table><thead><tr><th>Session</th><th>Account</th><th>Status</th><th>Last connected</th><th>Actions</th></tr></thead><tbody>
                    {filtered.map(session => <SessionRow key={session.id} session={session} csrfToken={csrfToken} refresh={refresh} />)}
                </tbody></table></div>
            ) : <EmptyState icon={Smartphone} title="No sessions found" detail="Pairing requests and saved accounts appear here once they exist on the backend." />}
        </section>
    );
}

function SessionRow({ session, csrfToken, refresh }) {
    async function action(name) {
        const destructive = name === "logout" || name === "remove";
        const prompt = name === "remove"
            ? `Permanently delete the saved WhatsApp credentials for ${session.id}? This cannot be undone.`
            : `Are you sure you want to ${name} ${session.id}?`;
        if (destructive && !window.confirm(prompt)) return;
        try {
            await request(`/api/admin/sessions/${session.id}/${name}`, { method: "POST", csrfToken, body: JSON.stringify({ confirm: destructive }) });
            refresh();
        } catch (error) {
            window.alert(error.message);
        }
    }
    return <tr>
        <td><strong className="table-primary">{session.id}</strong><small>{session.type}</small></td>
        <td>{session.number}</td>
        <td><span className={`status-chip ${session.status === "connected" ? "status-online" : ""}`}><i />{session.status}</span></td>
        <td>{formatDate(session.lastConnectedAt)}</td>
        <td><div className="table-actions">
            <button aria-label={`Reconnect ${session.id}`} title="Reconnect" onClick={() => action("reconnect")}><RefreshCw size={14} /></button>
            <button aria-label={`Disconnect ${session.id}`} title="Disconnect" onClick={() => action("disconnect")}><X size={14} /></button>
            <button aria-label={`Log out ${session.id}`} title="Log out" onClick={() => action("logout")}><LogOut size={14} /></button>
            <button
                aria-label={`Delete ${session.id}`}
                title={session.type === "primary" ? "The primary session cannot be deleted individually. Use Clear all sessions to unlink it." : "Delete saved session"}
                disabled={session.type === "primary"}
                onClick={() => action("remove")}
            ><Trash2 size={14} /></button>
        </div></td>
    </tr>;
}

function SettingsPage({ csrfToken }) {
    const [settings, setSettings] = useState(null);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    useEffect(() => {
        request("/api/admin/settings").then(result => setSettings(result.settings)).catch(requestError => setError(requestError.message));
    }, []);
    async function save(event) {
        event.preventDefault();
        setError("");
        setNotice("");
        try {
            const result = await request("/api/admin/settings", { method: "PATCH", csrfToken, body: JSON.stringify({ botName: settings.botName, prefix: settings.prefix, mode: settings.mode }) });
            setSettings(current => ({ ...current, ...result.settings }));
            setNotice("Settings saved to the bot configuration.");
        } catch (requestError) {
            setError(requestError.message);
        }
    }
    if (!settings) return <LoadingCard error={error} />;
    return <section className="panel-card form-card">
        <div className="card-heading"><div className="card-heading-icon"><Settings2 size={18} /></div><div><span className="eyebrow">LIVE CONFIGURATION</span><h2>Bot settings</h2></div></div>
        <p className="card-intro">Only supported settings are editable here. Changes are saved to the existing settings file.</p>
        <form className="settings-form" onSubmit={save}>
            <label>Bot display name<input value={settings.botName} maxLength={40} onChange={event => setSettings({ ...settings, botName: event.target.value })} /></label>
            <label>Command prefix<input value={settings.prefix} maxLength={3} onChange={event => setSettings({ ...settings, prefix: event.target.value })} /><small>One to three punctuation characters.</small></label>
            <label>Access mode<select value={settings.mode} onChange={event => setSettings({ ...settings, mode: event.target.value })}><option value="public">Public</option><option value="private">Private</option></select><small>Private mode restricts bot commands to the configured owner.</small></label>
            {error && <div className="form-error">{error}</div>}
            {notice && <div className="form-success"><Check size={15} />{notice}</div>}
            <button className="button button-primary"><Check size={16} /> Save settings</button>
        </form>
    </section>;
}

function CommandsPage() {
    const [commands, setCommands] = useState([]);
    const [error, setError] = useState("");
    const [search, setSearch] = useState("");
    const [category, setCategory] = useState("All categories");
    const [permission, setPermission] = useState("All permissions");
    const [selected, setSelected] = useState(null);
    useEffect(() => {
        request("/api/admin/commands").then(result => setCommands(result.commands)).catch(requestError => setError(requestError.message));
    }, []);
    const categories = useMemo(() => ["All categories", ...new Set(commands.map(command => command.category))], [commands]);
    const filtered = commands.filter(command =>
        `${command.name} ${command.description} ${command.category}`.toLowerCase().includes(search.toLowerCase()) &&
        (category === "All categories" || command.category === category) &&
        (permission === "All permissions" || command.permission === permission)
    );
    return <>
        <section className="panel-card">
            <div className="list-toolbar"><div><h2>Verified command registry</h2><p>{commands.length} available commands · backed by the bot's curated registry</p></div></div>
            <div className="filter-toolbar">
                <div className="search-field"><Search size={16} /><input placeholder="Search command or description…" value={search} onChange={event => setSearch(event.target.value)} /></div>
                <select value={category} onChange={event => setCategory(event.target.value)} aria-label="Filter by category">{categories.map(item => <option key={item}>{item}</option>)}</select>
                <select value={permission} onChange={event => setPermission(event.target.value)} aria-label="Filter by permission">{["All permissions", "User", "Group Admin", "Owner"].map(item => <option key={item}>{item}</option>)}</select>
            </div>
            {error && <div className="notice notice-error">{error}</div>}
            {filtered.length ? <div className="command-grid">{filtered.map(command => <button className="command-card" key={command.name} onClick={() => setSelected(command)}>
                <div className="command-card-top"><code>.{command.name}</code><span className={`permission-tag permission-${command.permission.toLowerCase().replace(" ", "-")}`}>{command.permission}</span></div>
                <p>{command.description}</p>
                <div className="command-card-bottom"><span>{command.category}</span><span className="available-state"><i /> Available</span></div>
            </button>)}</div> : <EmptyState icon={Search} title="No commands match" detail="Try changing the search text or filters." />}
        </section>
        {selected && <CommandDialog command={selected} onClose={() => setSelected(null)} />}
    </>;
}

function CommandDialog({ command, onClose }) {
    const syntax = `.${command.name}${command.argumentUsage ? ` ${command.argumentUsage}` : ""}`;
    return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }} onKeyDown={event => { if (event.key === "Escape") onClose(); }}>
        <section className="detail-dialog" role="dialog" aria-modal="true" aria-labelledby="command-detail-title">
            <button className="icon-button dialog-close" onClick={onClose} aria-label="Close command details"><X size={18} /></button>
            <span className="eyebrow">COMMAND DETAILS</span>
            <h2 id="command-detail-title"><code>.{command.name}</code></h2>
            <p>{command.description}</p>
            <div className="detail-row"><small>Category</small><strong>{command.category}</strong></div>
            <div className="detail-row"><small>Permission</small><strong>{command.permission}</strong></div>
            <div className="detail-row"><small>Availability</small><strong className="available-state"><i /> {command.availability}</strong></div>
            <div className="detail-row"><small>Required arguments</small><strong>{command.argumentUsage || "None listed"}</strong></div>
            <div className="detail-row"><small>Example usage</small><strong>{command.example || "Not provided by bot metadata"}</strong></div>
            <div className="detail-row"><small>Configuration</small><strong>Not specified by current metadata</strong></div>
            <div className="syntax-box"><small>SYNTAX</small><code>{syntax}</code><CopyButton text={syntax} label="Copy" /></div>
            {command.aliasNote && <div className="detail-row"><small>Aliases</small><strong>{command.aliasNote}</strong></div>}
            <div className="notice"><CircleHelp size={15} /> Command execution still enforces permissions on the bot backend.</div>
        </section>
    </div>;
}

function MenuPage({ csrfToken }) {
    const [settings, setSettings] = useState(null);
    const [videos, setVideos] = useState([]);
    const [notice, setNotice] = useState("");
    const [error, setError] = useState("");
    useEffect(() => {
        Promise.all([request("/api/admin/settings"), request("/api/admin/menu-videos")])
            .then(([settingsResult, videosResult]) => {
                setSettings(settingsResult.settings);
                setVideos(videosResult.videos);
            })
            .catch(requestError => setError(requestError.message));
    }, []);
    async function save(event) {
        event.preventDefault();
        try {
            await request("/api/admin/settings", { method: "PATCH", csrfToken, body: JSON.stringify({ botName: settings.botName }) });
            await request("/api/admin/menu-video", { method: "PATCH", csrfToken, body: JSON.stringify({ enabled: settings.menuVideoEnabled, filename: settings.menuVideoFile }) });
            setNotice("Menu settings saved to the existing bot configuration.");
            setError("");
        } catch (requestError) {
            setError(requestError.message);
        }
    }
    if (!settings) return <LoadingCard error={error} />;
    return <div className="content-grid">
        <section className="panel-card form-card">
            <div className="card-heading"><div className="card-heading-icon"><MonitorCog size={18} /></div><div><span className="eyebrow">WHATSAPP PRESENTATION</span><h2>Menu appearance</h2></div></div>
            <form className="settings-form" onSubmit={save}>
                <label>Menu title / bot name<input value={settings.botName} maxLength={40} onChange={event => setSettings({ ...settings, botName: event.target.value })} /></label>
                <label className="toggle-row"><span><strong>Enable configured menu video</strong><small>Video configuration remains available; menu delivery follows the bot's current menu behavior.</small></span><input type="checkbox" checked={settings.menuVideoEnabled} onChange={event => setSettings({ ...settings, menuVideoEnabled: event.target.checked })} /></label>
                <label>Selected video<select value={settings.menuVideoFile} onChange={event => setSettings({ ...settings, menuVideoFile: event.target.value })}>{videos.map(video => <option key={video.filename} value={video.filename}>{video.filename}</option>)}</select></label>
                {error && <div className="form-error">{error}</div>}
                {notice && <div className="form-success"><Check size={15} />{notice}</div>}
                <button className="button button-primary" disabled={!videos.length}><Check size={16} /> Save menu settings</button>
                {!videos.length && <small className="field-hint">No compatible videos found. Upload an MP4 in the video library first.</small>}
            </form>
        </section>
        <section className="panel-card menu-preview">
            <span className="eyebrow">LIVE CONFIGURATION PREVIEW</span>
            <div className="whatsapp-preview">
                <div className="preview-top"><span className="preview-avatar"><Bot size={17} /></span><span><strong>{settings.botName}</strong><small>WhatsApp menu preview</small></span><MoreHorizontal size={16} /></div>
                <div className="preview-message">
                    <strong>══『 {settings.botName} 』══</strong>
                    <span>〔 SYSTEM INFO 〕</span>
                    <span>Prefix ⇆ .</span>
                    <span>Cmds ⇆ live count from bot</span>
                    <span>Uptime ⇆ live bot runtime</span>
                    <i>Command categories and access are generated by the bot.</i>
                </div>
                <small className="preview-note">Visual preview only · live values shown when the actual bot sends its menu</small>
            </div>
        </section>
    </div>;
}

function VideosPage({ csrfToken }) {
    const [library, setLibrary] = useState(null);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [busy, setBusy] = useState(false);
    const refresh = useCallback(async () => {
        try {
            setLibrary(await request("/api/admin/menu-videos"));
            setError("");
        } catch (requestError) {
            setError(requestError.message);
        }
    }, []);
    useEffect(() => { refresh(); }, [refresh]);
    async function upload(file) {
        if (!file) return;
        if (file.type !== "video/mp4" || file.size > 64 * 1024 * 1024) {
            setError("Choose an MP4 video smaller than 64 MB.");
            return;
        }
        setBusy(true);
        setError("");
        setNotice("");
        try {
            const url = `/api/admin/menu-videos?filename=${encodeURIComponent(file.name)}`;
            await request(url, { method: "POST", csrfToken, body: file, headers: { "Content-Type": "video/mp4" } });
            setNotice(`${file.name} uploaded successfully.`);
            await refresh();
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setBusy(false);
        }
    }
    async function selectVideo(filename) {
        try {
            await request("/api/admin/menu-video", { method: "PATCH", csrfToken, body: JSON.stringify({ filename }) });
            await refresh();
            setNotice(`${filename} is now selected.`);
        } catch (requestError) {
            setError(requestError.message);
        }
    }
    return <div className="content-grid video-layout">
        <section className="panel-card video-library-card">
            <div className="list-toolbar"><div><h2>Video library</h2><p>MP4 only · maximum 64 MB per file</p></div><label className={`button button-secondary upload-button ${busy ? "disabled" : ""}`}><ArrowDownToLine size={16} /> {busy ? "Uploading…" : "Upload MP4"}<input type="file" accept="video/mp4,.mp4" disabled={busy} onChange={event => upload(event.target.files?.[0])} /></label></div>
            <div className="notice"><Shield size={15} /> Uploads are available only to authenticated admins and are validated server-side.</div>
            {error && <div className="form-error">{error}</div>}
            {notice && <div className="form-success"><Check size={15} />{notice}</div>}
            {library?.videos?.length ? <div className="video-list">{library.videos.map(video => <div key={video.filename} className={`video-row ${video.selected ? "video-row-selected" : ""}`}>
                <div className="video-file-icon"><Video size={18} /></div>
                <div className="video-file-copy"><strong>{video.filename}</strong><small>{formatBytes(video.sizeBytes)} · MP4</small></div>
                {video.selected && <span className="selected-tag"><Check size={12} /> Selected</span>}
                {!video.selected && <button className="text-button" onClick={() => selectVideo(video.filename)}>Select</button>}
            </div>)}</div> : <EmptyState icon={Film} title="No menu videos yet" detail="Upload an MP4 to make it available in the bot's menu settings." />}
        </section>
        <section className="panel-card video-player-card">
            <span className="eyebrow">SELECTED VIDEO PREVIEW</span>
            {library?.selected ? <>
                <video controls preload="metadata" src={`/api/admin/menu-videos/${encodeURIComponent(library.selected)}`} />
                <strong className="player-filename">{library.selected}</strong>
                <span className="field-hint">{library.enabled ? "Video header enabled in settings" : "Video header currently disabled"}</span>
            </> : <div className="player-empty"><Film size={26} /><span>Select or upload a valid MP4 to preview it.</span></div>}
        </section>
    </div>;
}

function LogsPage() {
    const [error, setError] = useState("");
    useEffect(() => {
        request("/api/admin/logs").catch(requestError => setError(requestError.message));
    }, []);
    return <section className="panel-card"><EmptyState icon={Activity} title="Structured logs are not exposed" detail={error || "The current bot backend has no safe operational log API. No placeholder events are displayed."} /></section>;
}

function SystemPage({ overview }) {
    if (!overview) return <LoadingCard />;
    const rows = [
        ["Bot version", `v${overview.version}`],
        ["Primary connection", overview.status],
        ["Process uptime", overview.uptime],
        ["Registered commands", overview.commandCount],
        ["Registered sessions", overview.totalSessions],
        ["Connected sessions", overview.onlineNow],
        ["Resident memory", formatBytes(overview.memory?.rssBytes)],
        ["JavaScript heap", formatBytes(overview.memory?.heapUsedBytes)],
        ["Last backend check", formatDate(overview.checkedAt)]
    ];
    return <section className="panel-card system-info-card">
        <div className="card-heading"><div className="card-heading-icon"><Server size={18} /></div><div><span className="eyebrow">BACKEND TELEMETRY</span><h2>System information</h2></div><span className="status-chip status-online"><i /> Live API</span></div>
        <div className="system-info-grid">{rows.map(([label, value]) => <div className="system-info-row" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
        <p className="field-hint">All values are returned by the running bot process. Session credentials and authentication files are never sent to this page.</p>
    </section>;
}

function LoadingCard({ error }) {
    return <section className="panel-card"><div className="notice">{error ? <CircleHelp size={17} /> : <LoaderCircle className="spin" size={17} />}{error || "Loading real configuration from the bot…"}</div></section>;
}

function EmptyState({ icon: Icon, title, detail }) {
    return <div className="empty-state"><span><Icon size={22} /></span><strong>{title}</strong><p>{detail}</p></div>;
}

const root = createRoot(document.getElementById("root"));
root.render(<React.StrictMode><App /></React.StrictMode>);

if (import.meta.hot) {
    import.meta.hot.dispose(() => root.unmount());
}
