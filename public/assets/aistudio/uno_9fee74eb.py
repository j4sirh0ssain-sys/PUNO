"""UNO - a polished, animated two-player UNO built with Tkinter.

Highlights
  * Spring-physics card sprites: dealing, drawing, fanning, hover lift, flips
  * Rotated, glossy card faces with a tilted centre ellipse (drawn as polygons)
  * Playable-card glow, dimmed unplayable cards, pulsing turn indicators
  * Particle bursts, shockwave rings, card trails, confetti, screen shake
  * Big pop-in banners (UNO!, SKIP!, +2 ...), animated colour picker and win screen

Controls: click a card to play it, click the deck / button (or press Space) to
draw or pass, R starts a new game.
"""

from __future__ import annotations

import math
import json
import queue
import random
import secrets
import socket
import sys
import threading
import time
import tkinter as tk
from dataclasses import dataclass
from functools import lru_cache
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from tkinter import font as tkfont, messagebox, simpledialog
from urllib.parse import parse_qs, urlsplit

import qrcode

# --------------------------------------------------------------------------- #
# Palette & constants
# --------------------------------------------------------------------------- #
COLORS = ("Red", "Blue", "Green", "Yellow")
POWER_CARD_VALUES = frozenset(("Skip", "Reverse", "+2", "Wild", "+4"))
COLOR_HEX = {
    "Red": "#ee3f4f",
    "Blue": "#2f86f0",
    "Green": "#16b07a",
    "Yellow": "#f6c030",
    "Wild": "#1c2133",
}
BG_TOP = "#101329"
BG_MID = "#191d3a"
BG_BOTTOM = "#2b2850"
TABLE = "#153d4b"
TABLE_EDGE = "#36a89d"
INK = "#f4f4ed"
MUTED = "#9fb3b0"
GOLD = "#f5c84b"
CARD_WHITE = "#f8f6ea"
CARD_BACK = "#20233c"

BASE_W, BASE_H = 80, 114  # card size at scale 1.0
HAND_SCALE = 1.0
PILE_SCALE = 1.2
CPU_SCALE = 0.66
PILE_DX = 78  # discard pile is cx + PILE_DX, deck is cx - PILE_DX

STIPPLE_OK = sys.platform != "darwin"  # macOS Tk ignores stipple
TARGET_FPS = 120


BROWSER_PAGE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#101329">
<title>PUNO - Local game</title>
<style>
:root{color-scheme:dark;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#101329;color:#f4f4ed}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at 50% 30%,#194553,#101329 70%);padding:20px}
main{max-width:900px;margin:auto}.panel{background:#172438;border:1px solid #355260;border-radius:20px;padding:20px;margin:14px 0;box-shadow:0 12px 32px #0005}
h1{font-size:clamp(25px,6vw,42px);margin:4px 0;color:#ffd84d}h2{font-size:18px;margin:5px 0 12px}
.muted{color:#aab8c5}.row{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap}
.score{font-size:20px;font-weight:700}.status{min-height:28px;color:#ffe493;font-weight:600}
button,input{font:inherit;border-radius:12px;border:1px solid #526c7c;padding:12px 16px}
button{background:#f2bf3f;color:#151c27;font-weight:750;cursor:pointer}button:disabled{opacity:.42;cursor:default}
input{width:100%;background:#0d1826;color:#fff}.hidden{display:none!important}
.table{display:flex;align-items:center;justify-content:center;gap:22px;min-height:150px;flex-wrap:wrap}
.pile{min-width:100px;height:135px;border-radius:14px;display:grid;place-items:center;text-align:center;padding:8px;font-size:23px;font-weight:800;border:3px solid #fff;box-shadow:0 8px 18px #0008}
.hand{display:flex;overflow-x:auto;gap:9px;padding:10px 2px 16px;min-height:150px}
.card{flex:0 0 90px;height:130px;border-radius:14px;background:var(--card);color:white;border:2px solid #fff;box-shadow:0 7px 12px #0007;font-size:23px;text-shadow:0 2px 3px #0008}
.card:disabled{opacity:.5}.wild{background:conic-gradient(#ee3f4f 0 25%,#2f86f0 0 50%,#16b07a 0 75%,#f6c030 0)}
.colors{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.color{height:60px;border:2px solid white}
.join{max-width:440px;margin:12vh auto;text-align:center}.fine{font-size:13px}
@media(max-width:520px){body{padding:10px}.panel{padding:14px}.card{flex-basis:76px;height:112px}.pile{min-width:82px;height:116px}}
</style>
</head>
<body>
<main>
<section id="join" class="panel join">
  <h1>PUNO</h1><h2>Join the local game</h2>
  <p class="muted">Choose the name the other player will see.</p>
  <form id="joinForm"><input id="name" maxlength="18" autocomplete="nickname" placeholder="Your name" required>
  <p><button type="submit">Join game</button></p></form>
  <p id="joinError" class="status"></p><p class="fine muted">Both devices must be on the same Wi-Fi or local network.</p>
</section>
<section id="game" class="hidden">
  <div class="row"><div><h1>PUNO</h1><div id="names" class="muted"></div></div><div id="score" class="score"></div></div>
  <section class="panel"><div id="status" class="status">Connecting...</div>
    <div class="table">
      <div><div class="muted">Draw pile</div><button id="draw" class="pile">Draw</button><div id="deckCount" class="muted"></div></div>
      <div><div class="muted">Top card</div><div id="top" class="pile"></div><div id="currentColor" class="muted"></div></div>
    </div>
    <div class="row"><strong id="hostCount"></strong><strong id="remoteCount"></strong></div>
  </section>
  <section class="panel"><h2>Your hand</h2><div id="hand" class="hand"></div></section>
  <section id="winnerPanel" class="panel hidden"><div id="winner" class="status"></div><button id="restart">Play again</button></section>
</section>
</main>
<div id="wildModal" class="hidden" style="position:fixed;inset:0;background:#000b;display:grid;place-items:center;padding:20px">
  <section class="panel" style="width:min(480px,100%)"><h2>Choose a color</h2><div class="colors">
    <button class="color" data-color="Red" style="background:#ee3f4f">Red</button>
    <button class="color" data-color="Blue" style="background:#2f86f0">Blue</button>
    <button class="color" data-color="Green" style="background:#16b07a">Green</button>
    <button class="color" data-color="Yellow" style="background:#f6c030">Yellow</button>
  </div></section>
</div>
<script>
const token=new URLSearchParams(location.search).get("token");
const clientKey="puno-client-"+token,nameKey="puno-name-"+token;
const clientId=localStorage.getItem(clientKey)||((crypto.randomUUID&&crypto.randomUUID())||String(Math.random()).slice(2));
localStorage.setItem(clientKey,clientId);
const joinBox=document.getElementById("join"),gameBox=document.getElementById("game");
const nameInput=document.getElementById("name"),joinError=document.getElementById("joinError");
const storedName=localStorage.getItem(nameKey);if(storedName)nameInput.value=storedName;
let state=null,joined=false,pendingWild=null,busy=false;
async function post(action){
  if(busy)return;busy=true;
  try{const response=await fetch("/action",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({...action,token,client_id:clientId})});
    if(!response.ok)throw new Error("The host rejected that action.");
  }catch(error){joinError.textContent=error.message||"Could not reach the host."}
  finally{busy=false}
}
document.getElementById("joinForm").addEventListener("submit",event=>{
  event.preventDefault();const name=nameInput.value.trim();if(!name){joinError.textContent="Enter a name first.";return}
  localStorage.setItem(nameKey,name.slice(0,18));post({type:"join",name:name.slice(0,18)});
});
function cardText(card){return ({Skip:"SKIP",Reverse:"↻","+2":"+2","+4":"+4",Wild:"WILD"})[card.value]||card.value}
function render(s){
  state=s;
  if(s.remote_client_id===clientId){joined=true;joinBox.classList.add("hidden");gameBox.classList.remove("hidden")}
  else if(s.remote_connected){joinError.textContent="A browser player has already joined this invite."}
  if(!joined)return;
  document.getElementById("names").textContent=s.host_name+"  vs  "+s.remote_name;
  document.getElementById("score").textContent=s.host_score+"  :  "+s.remote_score;
  document.getElementById("status").textContent=s.message||"Your turn";
  document.getElementById("hostCount").textContent=s.host_name+" · "+s.host_count+" cards";
  document.getElementById("remoteCount").textContent="You · "+s.remote_count+" cards";
  document.getElementById("deckCount").textContent=s.deck_count+" cards";
  document.getElementById("currentColor").textContent="Current color: "+s.current_color;
  const top=document.getElementById("top");
  top.textContent=s.top?cardText(s.top):"";
  top.style.background=s.top&&s.top.color==="Wild"?"linear-gradient(135deg,#ee3f4f,#2f86f0,#16b07a,#f6c030)":(s.top_color||"#20233c");
  const canAct=s.turn==="cpu"&&!s.winner;
  const hand=document.getElementById("hand");hand.replaceChildren();
  for(const card of s.remote_hand){
    const button=document.createElement("button");button.className="card"+(card.color==="Wild"?" wild":"");
    if(card.color!=="Wild")button.style.setProperty("--card",card.hex);
    button.textContent=cardText(card);
    const playable=canAct&&(s.remote_drawn_uid===null||s.remote_drawn_uid===card.uid)&&
      (card.color==="Wild"||card.color===s.current_color||card.value===s.top.value);
    button.disabled=!playable;
    button.addEventListener("click",()=>{
      if(card.color==="Wild"){pendingWild=card.uid;document.getElementById("wildModal").classList.remove("hidden")}
      else post({type:"play",uid:card.uid,color:card.color});
    });
    hand.append(button);
  }
  const draw=document.getElementById("draw");
  draw.textContent=s.remote_drawn_uid===null?"Draw a card":"Pass turn";
  draw.disabled=!canAct;
  draw.onclick=()=>post({type:s.remote_drawn_uid===null?"draw":"pass"});
  const winnerPanel=document.getElementById("winnerPanel");
  winnerPanel.classList.toggle("hidden",!s.winner);
  if(s.winner){document.getElementById("winner").textContent=s.winner==="cpu"?"You win!":s.host_name+" wins.";draw.disabled=true}
}
document.querySelectorAll("[data-color]").forEach(button=>button.addEventListener("click",()=>{
  if(pendingWild===null)return;
  post({type:"play",uid:pendingWild,color:button.dataset.color});
  pendingWild=null;document.getElementById("wildModal").classList.add("hidden");
}));
document.getElementById("restart").addEventListener("click",()=>post({type:"restart"}));
async function refresh(){
  try{
    const response=await fetch("/state?token="+encodeURIComponent(token),{cache:"no-store"});
    if(!response.ok)throw new Error("Waiting for the host...");
    render(await response.json());
  }catch(error){if(!joined)joinError.textContent=error.message||"Waiting for the host."}
}
if(!token)joinError.textContent="This invite link is missing its game code.";
else{refresh();setInterval(refresh,120)}
</script>
</body>
</html>"""


class LanServer:
    def __init__(self) -> None:
        self.token = secrets.token_urlsafe(24)
        self.actions: queue.Queue[dict] = queue.Queue()
        self._state_lock = threading.Lock()
        self._state = b"{}"
        owner = self

        class Server(ThreadingHTTPServer):
            daemon_threads = True
            allow_reuse_address = True

        class Handler(BaseHTTPRequestHandler):
            def _respond(self, status: int, body: bytes, content_type: str) -> None:
                self.send_response(status)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)

            def _authorized(self, token: str) -> bool:
                return secrets.compare_digest(token, owner.token)

            def do_GET(self) -> None:
                parsed = urlsplit(self.path)
                token = parse_qs(parsed.query).get("token", [""])[0]
                if not self._authorized(token):
                    self._respond(403, b"Invalid game invite.", "text/plain; charset=utf-8")
                elif parsed.path == "/":
                    body = BROWSER_PAGE.encode("utf-8")
                    self._respond(200, body, "text/html; charset=utf-8")
                elif parsed.path == "/state":
                    with owner._state_lock:
                        body = owner._state
                    self._respond(200, body, "application/json; charset=utf-8")
                else:
                    self._respond(404, b"Not found.", "text/plain; charset=utf-8")

            def do_POST(self) -> None:
                if urlsplit(self.path).path != "/action":
                    self._respond(404, b"Not found.", "text/plain; charset=utf-8")
                    return
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                    if not 0 < length <= 8192:
                        self._respond(413, b"Invalid request size.", "text/plain; charset=utf-8")
                        return
                    action = json.loads(self.rfile.read(length).decode("utf-8"))
                except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
                    self._respond(400, b"Invalid action.", "text/plain; charset=utf-8")
                    return
                if not isinstance(action, dict) or not self._authorized(str(action.get("token", ""))):
                    self._respond(403, b"Invalid game invite.", "text/plain; charset=utf-8")
                    return
                owner.actions.put(action)
                self._respond(202, b'{"ok":true}', "application/json; charset=utf-8")

        self._find_lan_address = self._get_lan_address()
        self.httpd = Server(("0.0.0.0", 0), Handler)
        self.port = self.httpd.server_address[1]
        self.url = f"http://{self._find_lan_address}:{self.port}/?token={self.token}"
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    @staticmethod
    def _get_lan_address() -> str:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
                probe.connect(("192.0.2.1", 9))
                address = probe.getsockname()[0]
                if not address.startswith("127."):
                    return address
        except OSError:
            pass
        addresses = socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)
        for result in addresses:
            address = result[4][0]
            if not address.startswith("127."):
                return address
        raise OSError("No local network address is available for a browser invite.")

    def start(self) -> None:
        self.thread.start()

    def publish(self, state: dict) -> None:
        body = json.dumps(state, separators=(",", ":")).encode("utf-8")
        with self._state_lock:
            self._state = body

    def stop(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()


# --------------------------------------------------------------------------- #
# Small helpers
# --------------------------------------------------------------------------- #
@lru_cache(maxsize=4096)
def hex_rgb(value: str) -> tuple[int, int, int]:
    return int(value[1:3], 16), int(value[3:5], 16), int(value[5:7], 16)


def mix(a: str, b: str, t: float) -> str:
    t = 0.0 if t < 0 else 1.0 if t > 1 else t
    ar, ag, ab = hex_rgb(a)
    br, bg, bb = hex_rgb(b)
    return "#%02x%02x%02x" % (
        round(ar + (br - ar) * t), round(ag + (bg - ag) * t), round(ab + (bb - ab) * t)
    )


def ease_out(t: float) -> float:
    t = 0.0 if t < 0 else 1.0 if t > 1 else t
    return 1 - (1 - t) ** 3


def ease_out_back(t: float) -> float:
    t = 0.0 if t < 0 else 1.0 if t > 1 else t
    c1 = 1.70158
    c3 = c1 + 1
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2


def smoothing_alpha(dt: float, rate: float) -> float:
    return 1 - math.exp(-rate * dt)


@lru_cache(maxsize=256)
def rr_points(hw: int, hh: int, r: int, seg: int = 5) -> tuple[tuple[float, float], ...]:
    """Rounded-rectangle outline in local coordinates (centre = origin)."""
    pts = []
    corners = ((hw - r, -hh + r, -90), (hw - r, hh - r, 0),
               (-hw + r, hh - r, 90), (-hw + r, -hh + r, 180))
    for cx, cy, start in corners:
        for k in range(seg + 1):
            ang = math.radians(start + 90 * k / seg)
            pts.append((cx + r * math.cos(ang), cy + r * math.sin(ang)))
    return tuple(pts)


@lru_cache(maxsize=256)
def ell_points(rx: float, ry: float, tilt: float, a0: float = 0, a1: float = 360,
               n: int = 36, center: bool = False) -> tuple[tuple[float, float], ...]:
    t = math.radians(tilt)
    c, s = math.cos(t), math.sin(t)
    pts = [(0.0, 0.0)] if center else []
    for k in range(n + 1):
        ang = math.radians(a0 + (a1 - a0) * k / n)
        ex, ey = rx * math.cos(ang), ry * math.sin(ang)
        pts.append((ex * c - ey * s, ex * s + ey * c))
    return tuple(pts)


@dataclass(frozen=True)
class Card:
    color: str
    value: str
    uid: int


class Sprite:
    """Visual state of one card. Spring-driven towards its targets."""

    def __init__(self, card: Card, x: float, y: float, s: float, seq: int) -> None:
        self.card = card
        self.x = self.tx = x
        self.y = self.ty = y
        self.a = self.ta = 0.0
        self.s = self.ts = s
        self.vx = self.vy = self.va = self.vs = 0.0
        self.facing = self.tfacing = 0.0  # 0 = back, 1 = face
        self.arrive_face = False
        self.delay = 0.0
        self.boost = 0.0  # >0 -> drawn above everything (in flight)
        self.hov = 0.0
        self.dim = self.tdim = 0.0
        self.glow = self.tglow = 0.0
        self.jx = self.jy = self.ja = 0.0  # pile jitter
        self.seq = seq

    def update(self, dt: float) -> None:
        self.boost -= dt
        if self.delay > 0:
            self.delay -= dt
            return
        self.tfacing = 1.0 if self.arrive_face else 0.0
        k, c = 190.0, 21.0
        self.vx += ((self.tx - self.x) * k - self.vx * c) * dt
        self.vy += ((self.ty - self.y) * k - self.vy * c) * dt
        self.va += ((self.ta - self.a) * 150.0 - self.va * 17.0) * dt
        self.vs += ((self.ts - self.s) * 220.0 - self.vs * 24.0) * dt
        self.x += self.vx * dt
        self.y += self.vy * dt
        self.a += self.va * dt
        self.s += self.vs * dt
        step = 4.4 * dt
        if abs(self.tfacing - self.facing) <= step:
            self.facing = self.tfacing
        else:
            self.facing += step if self.tfacing > self.facing else -step
        alpha = smoothing_alpha(dt, 10)
        self.dim += (self.tdim - self.dim) * alpha
        self.glow += (self.tglow - self.glow) * alpha


# --------------------------------------------------------------------------- #
# Game
# --------------------------------------------------------------------------- #
class UnoGame:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        root.title("PUNO")
        root.geometry("1180x800")
        root.minsize(900, 700)
        root.configure(bg=BG_TOP)

        self.canvas = tk.Canvas(root, bg=BG_TOP, highlightthickness=0, cursor="arrow")
        self.canvas.pack(fill="both", expand=True)
        self.canvas.bind("<Button-1>", self.on_click)
        self.canvas.bind("<Motion>", self.on_motion)
        self.canvas.bind("<Leave>", lambda _e: setattr(self, "mouse", (-999, -999)))
        for key in ("r", "R"):
            root.bind(f"<KeyPress-{key}>", lambda _e: self.new_game())
        root.bind("<space>", lambda _e: self.on_space())
        root.bind("<Return>", lambda _e: self.on_space())

        fams = set(tkfont.families(root))
        self.family = next(
            (f for f in ("Segoe UI", "SF Pro Display", "Helvetica Neue", "Inter",
                         "Roboto", "DejaVu Sans", "Helvetica") if f in fams),
            "Helvetica",
        )
        self._fonts: dict[tuple, tkfont.Font] = {}

        self.W, self.H = 1180, 800
        self.cx = self.cy = 0.0
        self.table = (44, 96, 1136, 604)
        self.bg_img: tk.PhotoImage | None = None
        self.bg_size = (0, 0)
        self._bg_item = 0
        self.mouse = (-999, -999)
        self.cursor = "arrow"
        self.t = 0.0
        self._last = time.perf_counter()
        self._seq = 0
        self.shake = 0.0
        self.network_mode = False
        self.remote_name = "Browser player"
        self.remote_connected = False
        self.remote_client_id: str | None = None
        self.remote_drawn_uid: int | None = None
        self.network_error = ""
        self.lan_server: LanServer | None = None
        self._last_network_publish = 0.0
        self._timer_resolution = False
        self._closed = False

        self.buttons: dict[str, tuple[float, float, float, float]] = {}
        self.btn_anim: dict[str, float] = {}
        self.hover_btn: str | None = None
        self.hover_card: int | None = None
        self.hover_color: str | None = None
        self.color_boxes: dict[str, tuple[float, float, float, float]] = {}
        self.color_anim: dict[str, float] = {c: 0.0 for c in COLORS}

        rnd = random.Random(7)
        self.bokeh = [
            (rnd.random(), rnd.random(), rnd.uniform(60, 150), rnd.uniform(0.15, 0.4),
             rnd.uniform(0, 6.28), rnd.choice(COLORS))
            for _ in range(9)
        ]
        self.glow = hex_rgb(COLOR_HEX["Red"])
        self.score = {"player": 0, "cpu": 0}
        self.player_name = "Player"
        self.message = ""
        self.msg_time = 0.0
        self.picker_start = 0.0
        self.win_time = 0.0
        self.events: list[tuple[float, int, object]] = []
        self.particles: list[dict] = []
        self.banners: list[dict] = []
        self.sprites: dict[int, Sprite] = {}
        self.change_player_name(announce=False)
        self.network_mode = messagebox.askyesno(
            "Local multiplayer",
            "Host a local-network game? The other player can scan a QR code and play in a browser.",
            parent=root,
            default=messagebox.YES,
        )
        if self.network_mode:
            try:
                self.lan_server = LanServer()
                self.lan_server.start()
                self.show_lan_invite()
            except OSError as exc:
                messagebox.showerror(
                    "Could not start local multiplayer",
                    f"{exc}\n\nThe game will continue in CPU mode.",
                    parent=root,
                )
                if self.lan_server is not None:
                    self.lan_server.stop()
                self.lan_server = None
                self.network_mode = False
        if sys.platform == "win32":
            import ctypes
            self._timer_resolution = ctypes.windll.winmm.timeBeginPeriod(1) == 0
        root.protocol("WM_DELETE_WINDOW", self.close)
        self.new_game()
        self.publish_network_state()
        self.tick()

    def change_player_name(self, announce: bool = True) -> None:
        was_jasir = self.player_name.casefold() == "jasir"
        entered = simpledialog.askstring(
            "Player name",
            "What name should appear in the game?",
            parent=self.root,
            initialvalue=self.player_name,
        )
        if entered is None:
            return
        name = " ".join(entered.split())[:18]
        if not name:
            self.set_message("Your name can't be blank.")
            return
        self.player_name = name
        if announce:
            if name.casefold() == "jasir" and not was_jasir:
                self.set_message("JASIR power-up starts with a new game.")
                self.banner("POWER-UP READY", GOLD, size=0.55, dy=-105)
            else:
                self.set_message(f"Welcome, {self.player_name}!")
                self.banner("WELCOME!", GOLD, size=0.55, dy=-105)

    def show_lan_invite(self) -> None:
        if self.lan_server is None:
            return
        invite = tk.Toplevel(self.root)
        invite.title("PUNO - Browser invite")
        invite.resizable(False, False)
        invite.configure(bg=BG_TOP)

        qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=2)
        qr.add_data(self.lan_server.url)
        qr.make(fit=True)
        matrix = qr.get_matrix()
        scale = 5
        image = tk.PhotoImage(width=len(matrix[0]) * scale, height=len(matrix) * scale)
        for row_index, row in enumerate(matrix):
            pixels = "{" + " ".join(
                color
                for dark in row
                for color in (("#101329" if dark else "#ffffff"),) * scale
            ) + "}"
            for offset in range(scale):
                image.put(pixels, to=(0, row_index * scale + offset))

        tk.Label(
            invite,
            text="Scan to join from a browser",
            font=("Segoe UI", 16, "bold"),
            fg=INK,
            bg=BG_TOP,
        ).pack(padx=18, pady=(18, 8))
        qr_label = tk.Label(invite, image=image, bg="#ffffff", borderwidth=0)
        qr_label.image = image
        qr_label.pack(padx=18, pady=8)
        tk.Label(
            invite,
            text=self.lan_server.url,
            wraplength=380,
            justify="center",
            font=("Segoe UI", 9),
            fg=MUTED,
            bg=BG_TOP,
        ).pack(padx=18, pady=8)
        self.invite_status = tk.StringVar(value="Waiting for the other player...")
        tk.Label(
            invite,
            textvariable=self.invite_status,
            font=("Segoe UI", 11, "bold"),
            fg=GOLD,
            bg=BG_TOP,
        ).pack(padx=18, pady=(4, 18))
        self.invite_window = invite

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            if self.lan_server is not None:
                self.lan_server.stop()
        finally:
            if self._timer_resolution:
                import ctypes
                ctypes.windll.winmm.timeEndPeriod(1)
            self.root.destroy()

    def process_network_actions(self) -> None:
        if self.lan_server is None:
            return
        while True:
            try:
                action = self.lan_server.actions.get_nowait()
            except queue.Empty:
                return

            action_type = action.get("type")
            client_id = action.get("client_id")
            if not isinstance(client_id, str) or not client_id or len(client_id) > 100:
                self.network_error = "Invalid browser session."
                continue
            if action_type == "join":
                name = action.get("name")
                if not isinstance(name, str):
                    self.network_error = "The browser player needs a name."
                    continue
                name = " ".join(name.split())[:18]
                if not name:
                    self.network_error = "The browser player needs a name."
                    continue
                if self.remote_connected and client_id != self.remote_client_id:
                    self.network_error = "This invite already has a browser player."
                    continue
                self.remote_name = name
                self.remote_client_id = client_id
                self.remote_connected = True
                self.network_error = ""
                self.set_message(f"{self.remote_name} joined the game.")
                self.banner("PLAYER JOINED", GOLD, size=0.6)
                self.invite_status.set(f"{self.remote_name} joined - game ready.")
                if self.turn == "waiting":
                    self.start_play()
                continue

            if not self.remote_connected or client_id != self.remote_client_id:
                self.network_error = "This browser is not the joined player."
                continue
            if action_type == "restart":
                if self.winner is not None:
                    self.new_game()
            elif action_type == "draw":
                self.remote_draw()
            elif action_type == "pass":
                if self.turn == "cpu" and self.remote_drawn_uid is not None:
                    self.remote_drawn_uid = None
                    self.turn = "busy"
                    self.later(0.55, lambda: self.give_player_turn("Your turn."))
            elif action_type == "play":
                uid = action.get("uid")
                color = action.get("color")
                if type(uid) is not int or not isinstance(color, str):
                    self.network_error = "Invalid card selection."
                    continue
                index = next(
                    (i for i, card in enumerate(self.cpu_hand) if card.uid == uid),
                    None,
                )
                if index is None or self.turn != "cpu":
                    continue
                card = self.cpu_hand[index]
                if self.remote_drawn_uid is not None and uid != self.remote_drawn_uid:
                    continue
                if not self.can_play(card):
                    continue
                if card.color == "Wild":
                    if color not in COLORS:
                        self.network_error = "Choose a valid color for the Wild card."
                        continue
                else:
                    color = card.color
                self.commit_remote_card(index, color)

    def publish_network_state(self) -> None:
        if self.lan_server is None:
            return
        top = self.discard[-1] if self.discard else None
        state = {
            "connected": self.remote_connected,
            "remote_connected": self.remote_connected,
            "remote_client_id": self.remote_client_id,
            "host_name": self.player_name,
            "remote_name": self.remote_name,
            "turn": self.turn,
            "message": self.network_error or self.message,
            "host_count": len(self.player_hand),
            "remote_count": len(self.cpu_hand),
            "host_score": self.score["player"],
            "remote_score": self.score["cpu"],
            "deck_count": len(self.deck),
            "top": ({"uid": top.uid, "color": top.color, "value": top.value} if top else None),
            "top_color": COLOR_HEX[top.color] if top else CARD_BACK,
            "current_color": self.current_color,
            "remote_drawn_uid": self.remote_drawn_uid,
            "remote_hand": [
                {"uid": card.uid, "color": card.color, "value": card.value,
                 "hex": COLOR_HEX[card.color]}
                for card in self.cpu_hand
            ] if self.remote_connected else [],
            "winner": self.winner,
        }
        self.lan_server.publish(state)

    # ------------------------------------------------------------------ #
    # Setup
    # ------------------------------------------------------------------ #
    def new_game(self) -> None:
        self.update_geometry()
        self.events = []
        self.particles = []
        self.banners = []
        self.sprites = {}
        self.pile: list[int] = []
        self.pending_wild: int | None = None
        self.winner: str | None = None
        self.drawn_uid: int | None = None
        self.remote_drawn_uid = None
        self.thinking = False
        self.turn = "dealing"
        self.shake = 0.0
        self.deck = self.make_deck()
        random.shuffle(self.deck)
        self.player_hand: list[Card] = []
        self.cpu_hand: list[Card] = []
        self.discard: list[Card] = []

        step = 0.085
        t0 = 0.45
        is_jasir = self.player_name.casefold() == "jasir"
        power_cards: list[Card] = []
        if is_jasir:
            power_cards = [card for card in self.deck if card.value in POWER_CARD_VALUES]
            self.deck = [card for card in self.deck if card.value not in POWER_CARD_VALUES]
            self.player_hand.extend(power_cards)
            for i, card in enumerate(power_cards):
                self.spawn(card, delay=t0 + i * 0.035)

        for i in range(7):
            for who in ("player", "cpu"):
                card = self.deck.pop()
                (self.player_hand if who == "player" else self.cpu_hand).append(card)
                order = i * 2 + (1 if who == "cpu" else 0)
                self.spawn(card, delay=t0 + order * step)
        starter_index = next(
            (i for i in range(len(self.deck) - 1, -1, -1)
             if self.deck[i].value not in POWER_CARD_VALUES),
            len(self.deck) - 1,
        )
        starter = self.deck.pop(starter_index)
        self.discard = [starter]
        self.current_color = starter.color
        self.glow = hex_rgb(COLOR_HEX[starter.color])
        sp = self.spawn(starter, delay=t0 + 14 * step + 0.15)
        self.place_on_pile(sp)
        self.set_message("Shuffling and dealing...")
        if is_jasir:
            self.set_message("JASIR POWER-UP: all 32 power cards are yours!")
            self.banner("ALL POWER CARDS!", GOLD, size=0.62, dur=2.0, dy=-75)
        self.later(t0 + 14 * step + 1.0, self.start_play)

    def start_play(self) -> None:
        if self.network_mode and not self.remote_connected:
            self.turn = "waiting"
            self.set_message("Waiting for the browser player to scan the invite.")
            return
        self.turn = "player"
        self.set_message("Your turn - match the color or number.")
        self.banner("YOUR TURN", GOLD, size=0.55, dur=0.9)
        self.burst(self.cx - PILE_DX, self.cy, GOLD, 14, 180)

    @staticmethod
    def make_deck() -> list[Card]:
        cards: list[Card] = []
        uid = 0
        for color in COLORS:
            cards.append(Card(color, "0", uid))
            uid += 1
            for value in tuple(str(n) for n in range(1, 10)) + ("Skip", "Reverse", "+2"):
                for _ in range(2):
                    cards.append(Card(color, value, uid))
                    uid += 1
        for value in ("Wild", "+4"):
            for _ in range(4):
                cards.append(Card("Wild", value, uid))
                uid += 1
        return cards

    # ------------------------------------------------------------------ #
    # Utilities: timing, fonts, messages
    # ------------------------------------------------------------------ #
    def later(self, delay: float, fn) -> None:
        self._seq += 1
        self.events.append((self.t + delay, self._seq, fn))

    def run_events(self) -> None:
        due = [e for e in self.events if e[0] <= self.t]
        if due:
            self.events = [e for e in self.events if e[0] > self.t]
            for _, _, fn in sorted(due, key=lambda e: (e[0], e[1])):
                fn()

    def font(self, px: float, weight: str = "bold", slant: str = "roman") -> tkfont.Font:
        px = max(6, int(round(px / 2.0)) * 2)
        key = (px, weight, slant)
        f = self._fonts.get(key)
        if f is None:
            f = tkfont.Font(family=self.family, size=-px, weight=weight, slant=slant)
            self._fonts[key] = f
        return f

    def set_message(self, text: str) -> None:
        self.message = text
        self.msg_time = self.t

    # ------------------------------------------------------------------ #
    # Rules
    # ------------------------------------------------------------------ #
    def can_play(self, card: Card) -> bool:
        top = self.discard[-1]
        return (
            card.color == "Wild"
            or card.color == self.current_color
            or card.value == top.value
        )

    def draw_from_deck(self, hand: list[Card]) -> Card | None:
        if not self.deck:
            if len(self.discard) <= 1:
                return None
            top = self.discard.pop()
            self.deck = self.discard
            self.discard = [top]
            random.shuffle(self.deck)
            for uid in self.pile[:-1]:
                self.sprites.pop(uid, None)
            self.pile = self.pile[-1:]
            self.ring(self.cx - PILE_DX, self.cy, "#ffffff", 30, 150, 0.6, 4)
            self.burst(self.cx - PILE_DX, self.cy, "#ffffff", 20, 220)
            self.banner("RESHUFFLE", "#ffffff", size=0.5, dur=1.0, dy=-130)
        card = self.deck.pop()
        hand.append(card)
        return card

    def draw_one(self, who: str, delay: float = 0.0) -> Card | None:
        card = self.draw_from_deck(self.player_hand if who == "player" else self.cpu_hand)
        if card is not None:
            self.spawn(card, delay=delay)
        return card

    def draw_cards(self, who: str, n: int, delay: float = 0.0) -> None:
        for i in range(n):
            self.draw_one(who, delay + i * 0.17)
        if who == "player":
            self.drawn_uid = None

    # ------------------------------------------------------------------ #
    # Sprite management
    # ------------------------------------------------------------------ #
    def deck_pos(self) -> tuple[float, float]:
        return self.cx - PILE_DX, self.cy

    def pile_pos(self) -> tuple[float, float]:
        return self.cx + PILE_DX, self.cy

    def spawn(self, card: Card, delay: float = 0.0) -> Sprite:
        self._seq += 1
        x, y = self.deck_pos()
        sp = Sprite(card, x, y, PILE_SCALE, self._seq)
        sp.delay = delay
        sp.boost = delay + 1.2
        self.sprites[card.uid] = sp
        return sp

    def place_on_pile(self, sp: Sprite) -> None:
        sp.jx = random.uniform(-9, 9)
        sp.jy = random.uniform(-7, 7)
        sp.ja = random.uniform(-17, 17)
        sp.boost = max(sp.boost, 0.0) + 1.0
        self.pile.append(sp.card.uid)
        while len(self.pile) > 5:
            self.sprites.pop(self.pile.pop(0), None)

    def update_geometry(self) -> None:
        self.W = max(self.canvas.winfo_width(), 900)
        self.H = max(self.canvas.winfo_height(), 700)
        self.cx = self.W / 2
        self.table = (44, 96, self.W - 44, self.H - 196)
        self.cy = (self.table[1] + self.table[3]) / 2 + 6

    def layout(self) -> None:
        W, H = self.W, self.H
        my_turn = self.turn == "player" and self.pending_wild is None
        n = len(self.player_hand)
        base_y = H - 84
        step = max(18.0, min(70.0, (W - 420) / max(n - 1, 1))) if n > 1 else 0.0
        half = max((n - 1) / 2, 0.001)
        for i, card in enumerate(self.player_hand):
            sp = self.sprites.get(card.uid)
            if sp is None:
                continue
            t = i - (n - 1) / 2
            u = t / half if n > 1 else 0.0
            playable = my_turn and self.can_play(card) and (
                self.drawn_uid is None or card.uid == self.drawn_uid
            )
            sp.arrive_face = True
            sp.tx = self.cx + t * step
            sp.ty = base_y + u * u * 18 - (16 if playable else 0)
            sp.ta = u * min(10.0, 1.8 * half + 0.5)
            sp.ts = HAND_SCALE
            sp.tdim = 0.5 if (my_turn and not playable) else 0.0
            sp.tglow = 1.0 if playable else 0.0

        n = len(self.cpu_hand)
        step = min(34.0, 330.0 / max(n - 1, 1)) if n > 1 else 0.0
        half = max((n - 1) / 2, 0.001)
        for i, card in enumerate(self.cpu_hand):
            sp = self.sprites.get(card.uid)
            if sp is None:
                continue
            t = i - (n - 1) / 2
            u = t / half if n > 1 else 0.0
            sp.arrive_face = False
            sp.tx = self.cx + t * step
            sp.ty = self.table[1] + 52 + (1 - u * u) * 7
            sp.ta = -u * 5
            sp.ts = CPU_SCALE
            sp.tdim = sp.tglow = 0.0

        px, py = self.pile_pos()
        for uid in self.pile:
            sp = self.sprites.get(uid)
            if sp is None:
                continue
            sp.arrive_face = True
            sp.tx, sp.ty = px + sp.jx, py + sp.jy
            sp.ta = sp.ja
            sp.ts = PILE_SCALE
            sp.tdim = sp.tglow = 0.0

    # ------------------------------------------------------------------ #
    # Particles & banners
    # ------------------------------------------------------------------ #
    def _add(self, p: dict) -> None:
        if len(self.particles) < 420:
            self.particles.append(p)

    def burst(self, x, y, color, n=24, speed=260.0, gravity=320.0) -> None:
        for _ in range(n):
            a = random.uniform(0, math.tau)
            v = random.uniform(0.3, 1.0) * speed
            life = random.uniform(0.45, 0.95)
            self._add({"k": "spark", "x": x, "y": y, "vx": math.cos(a) * v,
                       "vy": math.sin(a) * v, "life": life, "max": life,
                       "size": random.uniform(2, 5), "color": color, "g": gravity})

    def ring(self, x, y, color, r0=20.0, r1=140.0, dur=0.55, width=5.0) -> None:
        self._add({"k": "ring", "x": x, "y": y, "r0": r0, "r1": r1, "life": dur,
                   "max": dur, "color": color, "w": width})

    def confetti(self, n=3) -> None:
        for _ in range(n):
            life = random.uniform(2.2, 3.6)
            self._add({"k": "conf", "x": random.uniform(0, self.W), "y": -12,
                       "vx": random.uniform(-70, 70), "vy": random.uniform(120, 260),
                       "life": life, "max": life, "g": 40,
                       "rot": random.uniform(0, 6.28), "vr": random.uniform(-7, 7),
                       "w": random.uniform(6, 11), "h": random.uniform(4, 7),
                       "color": random.choice(list(COLOR_HEX.values())[:4] + [GOLD, "#ffffff"])})

    def banner(self, text, color, size=1.0, dur=1.15, dy=-20.0, delay=0.0) -> None:
        self.banners.append({"text": text, "color": color, "size": size, "dur": dur,
                             "dy": dy, "t0": self.t + delay})

    def update_particles(self, dt: float) -> None:
        alive = []
        for p in self.particles:
            p["life"] -= dt
            if p["life"] <= 0:
                continue
            if p["k"] != "ring":
                p["x"] += p["vx"] * dt
                p["y"] += p["vy"] * dt
                p["vy"] += p["g"] * dt
                drag = max(0.0, 1 - 1.4 * dt)
                p["vx"] *= drag
                if p["k"] == "conf":
                    p["rot"] += p["vr"] * dt
                if p["y"] > self.H + 30:
                    continue
            alive.append(p)
        self.particles = alive

    # ------------------------------------------------------------------ #
    # Play actions (player)
    # ------------------------------------------------------------------ #
    def on_space(self) -> None:
        if self.turn == "player" and self.pending_wild is None:
            self.player_draw()

    def player_draw(self) -> None:
        if self.turn != "player" or self.pending_wild is not None:
            return
        if self.drawn_uid is not None:
            self.drawn_uid = None
            self.begin_cpu_turn("You passed. CPU's turn.")
            return
        card = self.draw_one("player")
        if card is None:
            self.begin_cpu_turn("No cards left to draw - your turn passes.")
            return
        self.drawn_uid = card.uid
        self.set_message(
            "You drew a playable card - play it or pass."
            if self.can_play(card) else "No match - pass your turn."
        )

    def player_play(self, index: int) -> None:
        if not (0 <= index < len(self.player_hand)):
            return
        card = self.player_hand[index]
        sp = self.sprites.get(card.uid)
        if self.drawn_uid is not None and card.uid != self.drawn_uid:
            self.set_message("Play the card you just drew, or pass.")
            self.wiggle(sp)
            return
        if not self.can_play(card):
            self.set_message("That card doesn't match the color or number.")
            self.wiggle(sp)
            return
        if card.color == "Wild":
            self.pending_wild = index
            self.picker_start = self.t
            return
        self.commit_player_card(index, card.color)

    def wiggle(self, sp: Sprite | None) -> None:
        if sp is not None:
            sp.vx += random.choice((-1, 1)) * 420
            sp.va += random.choice((-1, 1)) * 220

    def finish_wild(self, color: str) -> None:
        if self.pending_wild is None:
            return
        index, self.pending_wild = self.pending_wild, None
        if index < len(self.player_hand):
            self.commit_player_card(index, color)

    def commit_player_card(self, index: int, color: str) -> None:
        card = self.player_hand.pop(index)
        self.discard.append(card)
        self.current_color = color
        self.drawn_uid = None
        sp = self.sprites[card.uid]
        self.place_on_pile(sp)
        self.later(0.30, lambda: self.impact(card))
        if not self.player_hand:
            self.turn = "busy"
            self.later(0.75, lambda: self.finish("player"))
            return
        if len(self.player_hand) == 1:
            self.banner("UNO!", GOLD, size=1.2, delay=0.45, dy=-95)
            self.later(0.45, lambda: self.burst(self.cx, self.cy - 95, GOLD, 30, 320))

        if card.value in ("Skip", "Reverse"):
            self.turn = "busy"
            self.set_message("CPU skipped - play again!")
            self.later(1.1, lambda: self.give_player_turn("Your turn again!"))
        elif card.value in ("+2", "+4"):
            n = int(card.value[1])
            self.turn = "busy"
            self.set_message(f"CPU draws {n} - play again!")
            self.later(0.35, lambda: self.draw_cards("cpu", n))
            self.later(1.2 + 0.17 * n, lambda: self.give_player_turn("Your turn again!"))
        else:
            self.begin_cpu_turn("CPU's turn.")

    def give_player_turn(self, msg: str) -> None:
        if self.winner:
            return
        self.turn = "player"
        self.thinking = False
        self.drawn_uid = None
        self.set_message(msg)

    def begin_cpu_turn(self, msg: str, delay: float = 1.1) -> None:
        self.turn = "cpu"
        if self.network_mode:
            self.thinking = False
            self.remote_drawn_uid = None
            self.set_message(f"{self.remote_name}'s turn in the browser.")
            return
        self.thinking = True
        self.set_message(msg)
        self.later(delay, self.cpu_turn)

    # ------------------------------------------------------------------ #
    # CPU
    # ------------------------------------------------------------------ #
    def cpu_turn(self) -> None:
        if self.network_mode or self.turn != "cpu" or self.winner:
            return
        valid = [c for c in self.cpu_hand if self.can_play(c)]
        if not valid:
            card = self.draw_one("cpu")
            if card is not None and self.can_play(card):
                self.later(0.95, lambda: self.cpu_play(card))
            else:
                self.turn = "busy"
                self.later(0.8, lambda: self.give_player_turn("CPU drew a card. Your turn!"))
            return
        order = {"Wild": 0, "+4": 1, "Skip": 2, "Reverse": 2, "+2": 2}
        card = max(valid, key=lambda c: (order.get(c.value, 3), random.random()))
        self.cpu_play(card)

    def cpu_play(self, card: Card) -> None:
        if self.winner or card not in self.cpu_hand:
            return
        self.thinking = False
        self.cpu_hand.remove(card)
        self.discard.append(card)
        if card.color == "Wild":
            counts = {c: sum(1 for k in self.cpu_hand if k.color == c) for c in COLORS}
            best = max(counts.values())
            self.current_color = random.choice([c for c, v in counts.items() if v == best])
        else:
            self.current_color = card.color
        sp = self.sprites[card.uid]
        self.place_on_pile(sp)
        self.later(0.30, lambda: self.impact(card))
        if not self.cpu_hand:
            self.turn = "busy"
            self.later(0.75, lambda: self.finish("cpu"))
            return
        if len(self.cpu_hand) == 1:
            self.banner("CPU: UNO!", "#ff7b7b", size=1.0, delay=0.45, dy=-95)
        if card.value in ("Skip", "Reverse"):
            self.begin_cpu_turn("CPU played a skip - it goes again.", 1.5)
        elif card.value in ("+2", "+4"):
            n = int(card.value[1])
            self.turn = "busy"
            self.later(0.35, lambda: self.draw_cards("player", n))
            self.set_message(f"CPU played {card.value} - you draw {n}.")
            self.later(1.2 + 0.17 * n, lambda: self.begin_cpu_turn(
                f"CPU goes again. Color: {self.current_color}.", 0.6))
        else:
            self.turn = "busy"
            msg = (f"CPU called UNO! Color is {self.current_color}."
                   if len(self.cpu_hand) == 1 else f"Your turn - color is {self.current_color}.")
            self.later(0.6, lambda: self.give_player_turn(msg))

    def remote_draw(self) -> None:
        if self.turn != "cpu" or not self.remote_connected or self.winner:
            return
        if self.remote_drawn_uid is not None:
            return
        card = self.draw_one("cpu")
        if card is None:
            self.turn = "busy"
            self.set_message("No cards left to draw - your turn.")
            self.later(0.55, lambda: self.give_player_turn("Your turn."))
            return
        self.remote_drawn_uid = card.uid
        self.set_message(
            "You drew a playable card - play it or pass."
            if self.can_play(card) else "No match - pass your turn."
        )

    def commit_remote_card(self, index: int, color: str) -> None:
        if not (0 <= index < len(self.cpu_hand)) or self.turn != "cpu":
            return
        card = self.cpu_hand.pop(index)
        self.discard.append(card)
        self.current_color = color
        self.remote_drawn_uid = None
        self.place_on_pile(self.sprites[card.uid])
        self.later(0.30, lambda: self.impact(card))
        if not self.cpu_hand:
            self.turn = "busy"
            self.later(0.75, lambda: self.finish("cpu"))
            return
        if len(self.cpu_hand) == 1:
            self.banner(f"{self.remote_name}: UNO!", GOLD, size=1.0, delay=0.45, dy=-95)
        if card.value in ("Skip", "Reverse"):
            self.begin_cpu_turn(f"{self.remote_name} played a skip - play again!", 1.5)
        elif card.value in ("+2", "+4"):
            n = int(card.value[1])
            self.turn = "busy"
            self.later(0.35, lambda: self.draw_cards("player", n))
            self.set_message(f"{self.remote_name} played {card.value} - you draw {n}.")
            self.later(1.2 + 0.17 * n, lambda: self.begin_cpu_turn(
                f"{self.remote_name} goes again. Color: {self.current_color}.", 0.6))
        else:
            self.turn = "busy"
            msg = (f"{self.remote_name} called UNO! Color is {self.current_color}."
                   if len(self.cpu_hand) == 1 else f"Your turn - color is {self.current_color}.")
            self.later(0.6, lambda: self.give_player_turn(msg))

    # ------------------------------------------------------------------ #
    # Effects tied to game events
    # ------------------------------------------------------------------ #
    def impact(self, card: Card) -> None:
        if self.winner and self.turn == "over":
            return
        x, y = self.pile_pos()
        col = COLOR_HEX[self.current_color]
        self.burst(x, y, col, 28, 300)
        self.burst(x, y, "#ffffff", 8, 200)
        self.ring(x, y, col, 30, 170, 0.6, 6)
        if card.value == "Skip":
            self.banner("SKIP!", col)
        elif card.value == "Reverse":
            self.banner("REVERSE!", col)
        elif card.value == "+2":
            self.banner("+2", col, size=1.3)
            self.shake = max(self.shake, 7)
        elif card.value == "+4":
            self.banner("+4", col, size=1.5)
            self.shake = max(self.shake, 14)
            self.ring(x, y, "#ffffff", 20, 260, 0.8, 4)
        elif card.value == "Wild":
            self.banner(self.current_color.upper(), col, size=1.1)
            self.ring(x, y, col, 20, 240, 0.8, 5)
        if card.color == "Wild":
            self.ring(x, y, col, 20, 230, 0.8, 5)

    def finish(self, who: str) -> None:
        self.turn = "over"
        self.winner = who
        self.thinking = False
        self.win_time = self.t
        self.score[who] += 1
        if who == "player" or (self.network_mode and who == "cpu"):
            self.confetti(60)
            for k in range(5):
                self.later(0.15 * k, lambda: self.burst(
                    random.uniform(200, self.W - 200), random.uniform(150, 400),
                    random.choice(list(COLOR_HEX.values())[:4]), 40, 380))

    # ------------------------------------------------------------------ #
    # Input
    # ------------------------------------------------------------------ #
    @staticmethod
    def in_box(x, y, box) -> bool:
        return bool(box and box[0] <= x <= box[2] and box[1] <= y <= box[3])

    def on_motion(self, event) -> None:
        self.mouse = (event.x, event.y)

    def card_at(self, mx: float, my: float) -> int | None:
        if self.hover_card is not None and self.hover_card < len(self.player_hand):
            sp = self.sprites.get(self.player_hand[self.hover_card].uid)
            if sp is not None:
                hw, hh = BASE_W / 2 * sp.s * 1.14, BASE_H / 2 * sp.s * 1.14
                if abs(mx - sp.x) <= hw and sp.y - 30 - hh <= my <= sp.y + hh:
                    return self.hover_card
        for i in range(len(self.player_hand) - 1, -1, -1):
            sp = self.sprites.get(self.player_hand[i].uid)
            if sp is None or sp.delay > 0:
                continue
            hw, hh = BASE_W / 2 * sp.s, BASE_H / 2 * sp.s
            if abs(mx - sp.x) <= hw and sp.y - hh - 6 <= my <= sp.y + hh:
                return i
        return None

    def on_click(self, event) -> None:
        x, y = event.x, event.y
        if self.turn == "over":
            if self.in_box(x, y, self.buttons.get("player_name")):
                self.change_player_name()
            elif self.in_box(x, y, self.buttons.get("restart")):
                self.new_game()
            return
        if self.pending_wild is not None:
            for color, box in self.color_boxes.items():
                if self.in_box(x, y, box):
                    self.finish_wild(color)
                    return
            return
        if self.in_box(x, y, self.buttons.get("new")):
            self.new_game()
            return
        if self.in_box(x, y, self.buttons.get("player_name")):
            self.change_player_name()
            return
        if self.turn != "player":
            return
        if self.in_box(x, y, self.buttons.get("draw")) or self.in_box(x, y, self.deck_box()):
            self.player_draw()
            return
        idx = self.card_at(x, y)
        if idx is not None:
            self.player_play(idx)

    def deck_box(self) -> tuple[float, float, float, float]:
        x, y = self.deck_pos()
        hw, hh = BASE_W / 2 * PILE_SCALE, BASE_H / 2 * PILE_SCALE
        return x - hw, y - hh, x + hw, y + hh

    def update_hover(self, dt: float) -> None:
        mx, my = self.mouse
        self.hover_btn = None
        self.hover_card = None
        self.hover_color = None
        if self.pending_wild is not None:
            for color, box in self.color_boxes.items():
                if self.in_box(mx, my, box):
                    self.hover_color = color
        elif self.turn == "over":
            if self.in_box(mx, my, self.buttons.get("restart")):
                self.hover_btn = "restart"
        else:
            for name, box in self.buttons.items():
                if self.in_box(mx, my, box):
                    self.hover_btn = name
            if self.turn == "player":
                if self.in_box(mx, my, self.deck_box()):
                    self.hover_btn = "deck"
                else:
                    self.hover_card = self.card_at(mx, my)
        for name in ("new", "draw", "restart", "deck", "player_name"):
            target = 1.0 if self.hover_btn == name else 0.0
            cur = self.btn_anim.get(name, 0.0)
            self.btn_anim[name] = cur + (target - cur) * smoothing_alpha(dt, 14)
        for color in COLORS:
            target = 1.0 if self.hover_color == color else 0.0
            self.color_anim[color] += (target - self.color_anim[color]) * smoothing_alpha(dt, 14)
        for i, card in enumerate(self.player_hand):
            sp = self.sprites.get(card.uid)
            if sp is not None:
                target = 1.0 if i == self.hover_card else 0.0
                sp.hov += (target - sp.hov) * smoothing_alpha(dt, 16)
        want = "hand2" if (self.hover_btn or self.hover_card is not None or self.hover_color) else "arrow"
        if want != self.cursor:
            self.cursor = want
            self.canvas.configure(cursor=want)

    # ------------------------------------------------------------------ #
    # Main loop
    # ------------------------------------------------------------------ #
    def tick(self) -> None:
        frame_start = time.perf_counter()
        dt = min(frame_start - self._last, 0.05)
        self._last = frame_start
        self.t += dt
        self.update_geometry()
        self.process_network_actions()
        self.run_events()
        self.layout()
        # Smaller simulation steps keep spring motion stable when a frame runs late.
        steps = max(1, math.ceil(dt / (1 / 120)))
        step_dt = dt / steps
        for sp in list(self.sprites.values()):
            if sp.delay > 0:  # still waiting on the deck: follow it on resize
                sp.x, sp.y = self.deck_pos()
            for _ in range(steps):
                sp.update(step_dt)
            if sp.boost > 0 and sp.delay <= 0:
                speed = math.hypot(sp.vx, sp.vy)
                if speed > 380 and random.random() < 0.85:
                    col = COLOR_HEX[sp.card.color] if sp.facing > 0.5 else "#ffffff"
                    if sp.card.color == "Wild":
                        col = random.choice(list(COLOR_HEX.values())[:4])
                    self._add({"k": "spark", "x": sp.x + random.uniform(-6, 6),
                               "y": sp.y + random.uniform(-6, 6), "vx": random.uniform(-25, 25),
                               "vy": random.uniform(-25, 25), "life": 0.38, "max": 0.38,
                               "size": random.uniform(2, 4.5), "color": col, "g": 0})
        self.update_hover(dt)
        self.update_particles(dt)
        target = hex_rgb(COLOR_HEX[self.current_color])
        k = smoothing_alpha(dt, 5)
        self.glow = tuple(g + (tg - g) * k for g, tg in zip(self.glow, target))
        self.shake = max(0.0, self.shake - dt * 30)
        if self.winner == "player" and random.random() < 0.8:
            self.confetti(2)
        self.draw()
        if self.lan_server is not None and self.t - self._last_network_publish >= 0.08:
            self.publish_network_state()
            self._last_network_publish = self.t
        render_time = time.perf_counter() - frame_start
        delay_ms = max(1, round(1000 / TARGET_FPS - render_time * 1000))
        self.root.after(delay_ms, self.tick)

    @property
    def glow_hex(self) -> str:
        r, g, b = self.glow
        return "#%02x%02x%02x" % (round(r), round(g), round(b))

    # ------------------------------------------------------------------ #
    # Drawing primitives
    # ------------------------------------------------------------------ #
    def rrect(self, x1, y1, x2, y2, r, **kw):
        r = min(r, (x2 - x1) / 2, (y2 - y1) / 2)
        pts: list[float] = []
        for cx, cy, st in ((x2 - r, y1 + r, -90), (x2 - r, y2 - r, 0),
                           (x1 + r, y2 - r, 90), (x1 + r, y1 + r, 180)):
            for k in range(5):
                ang = math.radians(st + 90 * k / 4)
                pts += [cx + r * math.cos(ang), cy + r * math.sin(ang)]
        kw.setdefault("outline", "")
        return self.canvas.create_polygon(pts, **kw)

    def dim_overlay(self, amount: float = 1.0) -> None:
        if STIPPLE_OK and amount > 0.02:
            self.canvas.create_rectangle(
                0, 0, self.W, self.H, fill="#04080d",
                stipple="gray50" if amount < 0.99 else "gray75", outline="")

    # ------------------------------------------------------------------ #
    # Card renderer (rotated polygons)
    # ------------------------------------------------------------------ #
    def draw_card(self, card: Card | None, x: float, y: float, a: float = 0.0,
                  s: float = 1.0, facing: float = 1.0, dim: float = 0.0,
                  glow: float = 0.0, glow_color: str = "#ffe27a", lift: float = 0.0) -> None:
        c = self.canvas
        fx = max(abs(facing * 2 - 1), 0.03)
        face = facing > 0.5 and card is not None
        cr, sr = math.cos(math.radians(a)), math.sin(math.radians(a))
        sx, sy = s * fx, s

        def T(pts, ox=0.0, oy=0.0):
            out: list[float] = []
            for u, v in pts:
                ux, uy = u * sx, v * sy
                out.append(x + ox + ux * cr - uy * sr)
                out.append(y + oy + ux * sr + uy * cr)
            return out

        def P(u, v):
            return x + u * sx * cr - v * sy * sr, y + u * sx * sr + v * sy * cr

        def tn(col):
            return mix(col, "#0d141c", dim) if dim > 0.01 else col

        # shadow
        so = 5 * s + lift * 0.3
        spread = min(7.0, 1.5 + lift * 0.16)
        for layer in (3, 2, 1):
            expand = spread * layer / 3
            shade = mix("#050b10", "#142633", (3 - layer) * 0.18)
            c.create_polygon(
                T(rr_points(42 + expand, 59 + expand, 11 + expand),
                  0, so + layer * 1.4),
                fill=shade,
                outline="",
            )
        c.create_polygon(
            T(rr_points(40, 57, 9), 0, 4.5 * s),
            fill=tn("#8993a4"),
            outline="",
        )
        # glow
        if glow > 0.03:
            for grow, amt in ((10, 0.16), (6, 0.34), (3, 0.7)):
                c.create_polygon(
                    T(rr_points(40 + grow, 57 + grow, 9 + grow)),
                    fill=mix("#10282a", glow_color, amt * min(glow, 1.0)), outline="")
        # body
        c.create_polygon(
            T(rr_points(40, 57, 9)),
            fill=tn(CARD_WHITE),
            outline=tn("#b4c0cb"),
            width=max(1.0, 1.5 * s),
        )

        def text(u, v, txt, size, fill, extra=0.0, shadow=None):
            if fx < 0.4:
                return
            px, py = P(u, v)
            f = self.font(size * s, "bold", "italic")
            ang = -(a + extra)
            if shadow:
                c.create_text(px + 1.6 * s, py + 2.2 * s, text=txt, fill=shadow, font=f, angle=ang)
            c.create_text(px, py, text=txt, fill=fill, font=f, angle=ang)

        if not face:
            c.create_polygon(T(rr_points(35, 52, 6)), fill=tn(CARD_BACK), outline="")
            c.create_polygon(
                T(ell_points(30, 46, 28), 0, 2.5 * s),
                fill=tn("#a9293a"),
                outline="",
            )
            c.create_polygon(T(ell_points(30, 46, 28)), fill=tn("#e5384a"), outline="")
            c.create_polygon(T(ell_points(30, 46, 28)), fill="", outline=tn("#ff8a93"), width=1)
            text(0, 0, "PUNO", 16, tn("#ffd84d"), -26, shadow=tn("#5b0f18"))
            return

        base = COLOR_HEX[card.color]
        c.create_polygon(T(rr_points(35, 52, 6)), fill=tn(base), outline="")
        gloss = [p for p in rr_points(35, 52, 6) if p[1] < -30]
        if gloss and card.color != "Wild":
            top = [p for p in gloss if p[0] > 0]
            left = [p for p in gloss if p[0] < 0]
            c.create_polygon(T(top + [(35, -18), (-35, -18)] + left),
                             fill=tn(mix(base, "#ffffff", 0.14)), outline="")

        if card.color == "Wild":
            quad = ("Red", "Blue", "Green", "Yellow")
            for i, name in enumerate(quad):
                c.create_polygon(T(ell_points(29, 45, 28, 90 * i, 90 * (i + 1), 12, True)),
                                 fill=tn(COLOR_HEX[name]), outline="")
            c.create_polygon(T(ell_points(29, 45, 28)), fill="", outline=tn("#ffffff"), width=2)
            if card.value == "+4":
                text(0, 1, "+4", 36, "#ffffff", 0, shadow="#10151f")
            corner = "+4" if card.value == "+4" else "W"
        else:
            c.create_polygon(T(ell_points(29, 45, 28)), fill=tn("#fffdf3"), outline="")
            col = tn(base)
            v = card.value
            if v in ("Skip", "Reverse"):
                if v == "Skip":
                    px, py = P(0, 0)
                    rx, ry = 18 * sx, 18 * sy
                    w = max(2.0, 6.5 * s)
                    if fx > 0.25:
                        c.create_oval(px - rx, py - ry, px + rx, py + ry, outline=col, width=w)
                        (x1, y1), (x2, y2) = P(-12.5, 12.5), P(12.5, -12.5)
                        c.create_line(x1, y1, x2, y2, fill=col, width=w, capstyle="round")
                    corner = "⊘"
                else:
                    d = 0.7071
                    for sign in (1, -1):
                        (x1, y1) = P(-sign * 15 * d + 7 * d * sign, sign * 15 * d + 7 * d * sign)
                        (x2, y2) = P(sign * 15 * d + 7 * d * sign, -sign * 15 * d + 7 * d * sign)
                        c.create_line(x1, y1, x2, y2, fill=col, width=max(2.0, 6 * s),
                                      arrow="last", arrowshape=(10 * s, 12 * s, 5 * s),
                                      capstyle="round")
                    corner = "↻"
            else:
                size = 34 if v == "+2" else 50
                text(0, 1, v, size, col, 0, shadow=tn(mix(base, "#000000", 0.25)))
                corner = v
        text(-26, -41, corner, 15, "#ffffff", 0, shadow=tn(mix(base, "#000000", 0.3)))
        text(26, 41, corner, 15, "#ffffff", 180, shadow=tn(mix(base, "#000000", 0.3)))
        if dim < 0.01:
            c.create_polygon(T(rr_points(40, 57, 9)), fill="", outline="#ffffff", width=1)

    def render_sprite(self, sp: Sprite) -> None:
        lift = sp.hov * 30
        s = sp.s * (1 + 0.14 * sp.hov)
        a = sp.a * (1 - 0.85 * sp.hov)
        glow = max(sp.glow * (0.6 + 0.4 * math.sin(self.t * 4 + sp.seq)), sp.hov * 0.95)
        self.draw_card(sp.card, sp.x, sp.y - lift, a, s, sp.facing, sp.dim * (1 - sp.hov),
                       glow, "#ffe27a", lift)

    # ------------------------------------------------------------------ #
    # Scene
    # ------------------------------------------------------------------ #
    def ensure_bg(self) -> None:
        size = (self.W, self.H)
        if size == self.bg_size and self.bg_img is not None:
            return
        img = tk.PhotoImage(width=self.W, height=self.H)
        band = 3
        for y in range(0, self.H, band):
            img.put(mix(BG_TOP, BG_BOTTOM, y / self.H), to=(0, y, self.W, min(self.H, y + band)))
        self.bg_img, self.bg_size = img, size

    def draw(self) -> None:
        c = self.canvas
        c.delete("all")
        self.buttons = {}
        self.color_boxes = {}
        self.ensure_bg()
        self._bg_item = c.create_image(0, 0, image=self.bg_img, anchor="nw")
        self.draw_bokeh()
        self.draw_header()
        self.draw_table()
        self.draw_badges()
        self.draw_piles()
        self.render_cards()
        self.draw_status()
        self.draw_particles()
        if self.pending_wild is not None:
            self.draw_picker()
        if self.turn == "over":
            self.draw_winner()
        self.draw_banners()
        if self.shake > 0.5:
            dx = math.sin(self.t * 48) * self.shake
            dy = math.sin(self.t * 41 + 1.7) * self.shake
            c.addtag_all("world")
            c.dtag(self._bg_item, "world")
            c.move("world", dx, dy)

    def draw_bokeh(self) -> None:
        c = self.canvas
        for fx, fy, r, sp, ph, col in self.bokeh:
            x = self.W * fx + math.sin(self.t * sp + ph) * 50
            y = self.H * fy + math.cos(self.t * sp * 0.8 + ph) * 36
            c.create_oval(x - r, y - r, x + r, y + r,
                          fill=mix(BG_MID, COLOR_HEX[col], 0.075), outline="")

    def draw_header(self) -> None:
        c = self.canvas
        W = self.W
        self.rrect(30, 16, 122, 64, 14, fill="#05090d")
        self.rrect(28, 14, 120, 62, 14, fill="#10151d", outline="#2c3646", width=1)
        pts = [(76 + x, 38 + y) for x, y in ell_points(38, 16, -14)]
        c.create_polygon([v for p in pts for v in p], fill="#e5384a", outline="")
        c.create_text(76, 39, text="PUNO", fill="#5b0f18", font=self.font(24, "bold", "italic"), angle=14)
        c.create_text(75, 37, text="PUNO", fill="#ffd84d", font=self.font(24, "bold", "italic"), angle=14)
        c.create_text(138, 30, text="CLASSIC", anchor="w", fill=INK, font=self.font(13))
        c.create_text(138, 48, text="TWO-PLAYER EDITION", anchor="w", fill=MUTED, font=self.font(10, "normal"))
        # score
        cx = W / 2
        self.rrect(cx - 105, 22, cx + 105, 58, 18, fill="#14232b", outline="#27414a", width=1)
        c.create_text(cx - 66, 40, text="YOU", fill=MUTED, font=self.font(11))
        opponent = self.remote_name if self.network_mode else "CPU"
        if len(opponent) > 9:
            opponent = opponent[:8] + ".."
        c.create_text(cx + 66, 40, text=opponent, fill=MUTED, font=self.font(11))
        c.create_text(cx, 40, text=f"{self.score['player']}  :  {self.score['cpu']}",
                      fill=INK, font=self.font(20))
        enabled = self.pending_wild is None
        shown_name = self.player_name if len(self.player_name) <= 10 else self.player_name[:9] + ".."
        self.draw_button(
            "player_name", W - 302, 20, W - 170, 60,
            f"Name: {shown_name}", True, primary=False,
        )
        self.draw_button("new", W - 160, 20, W - 32, 60, "New game", enabled, primary=False)

    def draw_button(self, name, x1, y1, x2, y2, label, enabled=True, primary=True, pulse=False):
        c = self.canvas
        anim = self.btn_anim.get(name, 0.0) if enabled else 0.0
        g = 2.5 * anim
        if enabled:
            self.buttons[name] = (x1, y1, x2, y2)
        self.rrect(x1 - g, y1 - g + 4, x2 + g, y2 + g + 4, 16, fill="#071014")
        if pulse and enabled:
            p = 0.5 + 0.5 * math.sin(self.t * 5)
            self.rrect(x1 - 6 - g, y1 - 6 - g, x2 + 6 + g, y2 + 6 + g, 20, fill="",
                       outline=mix(BG_MID, GOLD, 0.35 + 0.45 * p), width=2)
        if primary:
            fill = mix("#f2bf3f", "#ffe493", anim) if enabled else "#2f3f46"
            text = "#1b2128" if enabled else "#7b8c8b"
            outline = ""
        else:
            fill = mix("#1d2f38", "#2b4652", anim) if enabled else "#1a272e"
            text = INK if enabled else "#6d7f7d"
            outline = mix("#355260", "#7fb2c4", anim)
        self.rrect(x1 - g, y1 - g, x2 + g, y2 + g, 16, fill=fill, outline=outline, width=1)
        if primary and enabled:
            self.rrect(x1 - g + 3, y1 - g + 2, x2 + g - 3, (y1 + y2) / 2 - 2, 12,
                       fill=mix(fill, "#ffffff", 0.28))
        c.create_text((x1 + x2) / 2, (y1 + y2) / 2 + 1, text=label, fill=text, font=self.font(14))

    def draw_table(self) -> None:
        c = self.canvas
        l, t, r, b = self.table
        g = self.glow_hex
        pulse = 0.5 + 0.5 * math.sin(self.t * 2)
        for grow, amt in ((52, 0.05), (38, 0.08), (26, 0.12), (15, 0.17), (7, 0.24)):
            c.create_oval(l - grow, t - grow, r + grow, b + grow,
                          fill=mix(BG_MID, g, amt * (0.8 + 0.4 * pulse)), outline="")
        c.create_oval(l - 5, t - 5 + 4, r + 5, b + 5 + 4, fill="#06161a", outline="")
        c.create_oval(l, t, r, b, fill=TABLE, outline=mix(TABLE_EDGE, g, 0.45 + 0.35 * pulse), width=4)
        hx, hy = (r - l) / 2, (b - t) / 2
        mx, my = (l + r) / 2, (t + b) / 2
        for k in range(1, 6):
            f = k * 0.075
            c.create_oval(mx - hx * (1 - f), my - hy * (1 - f), mx + hx * (1 - f), my + hy * (1 - f),
                          fill=mix(TABLE, "#287f91", k / 6 * 0.75), outline="")
        c.create_oval(l + 16, t + 16, r - 16, b - 16, outline=mix(TABLE, "#ffffff", 0.14), width=1)
        # rotating arcs around the discard pile
        px, py = self.pile_pos()
        R = 98
        for i in range(3):
            c.create_arc(px - R, py - R, px + R, py + R, start=(self.t * 70 + i * 120) % 360,
                         extent=62, style="arc", outline=g, width=3)
        c.create_arc(px - R - 9, py - R - 9, px + R + 9, py + R + 9,
                     start=(-self.t * 40) % 360, extent=24, style="arc", outline=mix(TABLE, g, 0.5), width=2)

    def draw_badge(self, x, y, name, count, active, tint):
        c = self.canvas
        r = 24
        if active:
            p = 0.5 + 0.5 * math.sin(self.t * 5)
            c.create_oval(x - r - 8 - 4 * p, y - r - 8 - 4 * p, x + r + 8 + 4 * p, y + r + 8 + 4 * p,
                          outline=mix(BG_MID, GOLD, 0.35 + 0.5 * p), width=2)
        c.create_oval(x - r, y - r, x + r, y + r, fill=mix("#152731", tint, 0.35),
                      outline=GOLD if active else mix("#2d4553", tint, 0.5), width=3)
        c.create_text(x, y, text=name[0], fill=INK, font=self.font(22))
        c.create_text(x + r + 14, y - 11, text=name, anchor="w", fill=INK, font=self.font(15))
        c.create_text(x + r + 14, y + 11, text=f"{count} card{'s' if count != 1 else ''}",
                      anchor="w", fill=MUTED, font=self.font(12, "normal"))
        if count == 1:
            p = 0.5 + 0.5 * math.sin(self.t * 8)
            self.rrect(x + r + 14, y + 22, x + r + 62, y + 40, 9, fill=mix("#a8821f", GOLD, p))
            c.create_text(x + r + 38, y + 31, text="UNO!", fill="#1b2128", font=self.font(11))

    def draw_badges(self) -> None:
        self.draw_badge(66, self.H - 92, self.player_name, len(self.player_hand),
                        self.turn == "player" and self.pending_wild is None, COLOR_HEX["Blue"])
        opponent = self.remote_name if self.network_mode else "CPU"
        self.draw_badge(66, 128, opponent[:12], len(self.cpu_hand),
                        self.turn == "cpu" or self.thinking, COLOR_HEX["Red"])

    def draw_piles(self) -> None:
        c = self.canvas
        dx, dy = self.deck_pos()
        px, py = self.pile_pos()
        c.create_text(dx, dy - 92, text="DRAW PILE", fill=MUTED, font=self.font(11))
        c.create_text(px, py - 92, text="DISCARD", fill=MUTED, font=self.font(11))
        must_draw = (self.turn == "player" and self.pending_wild is None and self.drawn_uid is None
                     and not any(self.can_play(k) for k in self.player_hand))
        hov = self.btn_anim.get("deck", 0.0) if self.turn == "player" else 0.0
        if self.deck:
            layers = min(5, max(1, len(self.deck) // 6 + 1))
            for i in range(layers - 1, -1, -1):
                glow = 0.0
                if i == 0:
                    glow = max(hov * 0.9, (0.5 + 0.5 * math.sin(self.t * 5)) * 0.9 if must_draw else 0.0)
                self.draw_card(None, dx - i * 1.2, dy - i * 1.6 - hov * 6, 0, PILE_SCALE,
                               0.0, 0.0, glow, GOLD, hov * 6)
        else:
            self.rrect(dx - 46, dy - 66, dx + 46, dy + 66, 12, fill="", outline=mix(TABLE, "#ffffff", 0.3), width=2)
        c.create_text(dx, dy + 82, text=f"{len(self.deck)} cards", fill=MUTED, font=self.font(11, "normal"))
        # colour indicator
        col = COLOR_HEX[self.current_color]
        cy = self.cy + 118
        self.rrect(px - 62, cy - 16, px + 62, cy + 16, 16, fill="#10222a", outline=mix("#2b4651", col, 0.6), width=1)
        r = 7 + 1.2 * math.sin(self.t * 4)
        c.create_oval(px - 42 - r - 3, cy - r - 3, px - 42 + r + 3, cy + r + 3, outline=mix("#10222a", col, 0.5), width=1)
        c.create_oval(px - 42 - r, cy - r, px - 42 + r, cy + r, fill=col, outline="#ffffff")
        c.create_text(px - 26, cy + 1, text=self.current_color.upper(), anchor="w", fill=INK, font=self.font(12))
        # draw / pass button
        label = "Pass turn" if self.drawn_uid is not None else "Draw a card"
        enabled = self.turn == "player" and self.pending_wild is None
        self.draw_button("draw", dx - 70, cy - 20, dx + 70, cy + 20, label, enabled,
                         primary=True, pulse=must_draw)

    def render_cards(self) -> None:
        pile = [self.sprites[u] for u in self.pile if u in self.sprites]
        cpu = [self.sprites[k.uid] for k in self.cpu_hand if k.uid in self.sprites]
        ply = [self.sprites[k.uid] for k in self.player_hand if k.uid in self.sprites]
        normal, boosted = [], []
        for sp in pile + cpu + ply:
            (boosted if sp.boost > 0 else normal).append(sp)
        normal.sort(key=lambda sp: 1 if sp.hov > 0.02 else 0)
        boosted.sort(key=lambda sp: sp.seq)
        for sp in normal + boosted:
            self.render_sprite(sp)

    def draw_status(self) -> None:
        c = self.canvas
        text = self.message
        if self.thinking and self.turn == "cpu" and not self.network_mode:
            text = "CPU is thinking" + "." * (int(self.t * 3) % 4)
        if not text:
            return
        age = self.t - self.msg_time
        a = ease_out(age / 0.35)
        f = self.font(14, "bold")
        w = f.measure(text) + 58
        x, y = self.cx, self.table[3] - 36 + (1 - a) * 14
        self.rrect(x - w / 2, y - 18, x + w / 2, y + 18, 18, fill=mix("#0b1a1f", "#10282e", a),
                   outline=mix("#16363c", mix("#2c5560", self.glow_hex, 0.35), a), width=1)
        p = 0.5 + 0.5 * math.sin(self.t * 4)
        c.create_oval(x - w / 2 + 14, y - 4, x - w / 2 + 22, y + 4, fill=mix("#10282e", self.glow_hex, 0.6 + 0.4 * p), outline="")
        c.create_text(x + 8, y + 1, text=text, fill=mix(MUTED, INK, a), font=f)

    def draw_particles(self) -> None:
        c = self.canvas
        bg = "#15303a"
        for p in self.particles:
            f = p["life"] / p["max"]
            k = p["k"]
            if k == "spark":
                col = mix(bg, p["color"], min(1.0, f * 1.4))
                r = max(0.6, p["size"] * (0.4 + 0.6 * f))
                c.create_oval(p["x"] - r, p["y"] - r, p["x"] + r, p["y"] + r, fill=col, outline="")
            elif k == "ring":
                e = ease_out(1 - f)
                r = p["r0"] + (p["r1"] - p["r0"]) * e
                c.create_oval(p["x"] - r, p["y"] - r, p["x"] + r, p["y"] + r,
                              outline=mix(bg, p["color"], f), width=max(1.0, p["w"] * f))
            else:
                cr, sr = math.cos(p["rot"]), math.sin(p["rot"])
                w, h = p["w"] / 2, p["h"] / 2 * (0.4 + 0.6 * abs(math.cos(p["rot"] * 1.3)))
                pts = []
                for u, v in ((-w, -h), (w, -h), (w, h), (-w, h)):
                    pts += [p["x"] + u * cr - v * sr, p["y"] + u * sr + v * cr]
                c.create_polygon(pts, fill=mix(bg, p["color"], min(1.0, f * 3)), outline="")

    def draw_banners(self) -> None:
        c = self.canvas
        keep = []
        for b in self.banners:
            age = self.t - b["t0"]
            if age < 0:
                keep.append(b)
                continue
            if age > b["dur"]:
                continue
            keep.append(b)
            p = age / b["dur"]
            sc = ease_out_back(p / 0.22) if p < 0.22 else 1 + 0.05 * (p - 0.22)
            fade = 1.0 if p < 0.7 else 1 - (p - 0.7) / 0.3
            font = self.font(max(8.0, 66 * sc * b["size"]), "bold", "italic")
            x, y = self.cx, self.cy + b["dy"] - p * 34
            c.create_text(x + 4, y + 5, text=b["text"], font=font, fill=mix(BG_MID, "#000000", 0.6 * fade))
            c.create_text(x, y, text=b["text"], font=font, fill=mix(BG_MID, b["color"], fade))
        self.banners = keep

    def draw_picker(self) -> None:
        c = self.canvas
        self.dim_overlay(0.6)
        anim = ease_out_back((self.t - self.picker_start) / 0.3)
        cx, cy = self.cx, self.H / 2 - 20
        hw, hh = 250 * anim, 118 * anim
        self.rrect(cx - hw, cy - hh + 6, cx + hw, cy + hh + 6, 26 * anim, fill="#04090c")
        self.rrect(cx - hw, cy - hh, cx + hw, cy + hh, 26 * anim, fill="#1b2c35", outline="#46646f", width=2)
        if anim < 0.5:
            return
        c.create_text(cx, cy - 78 * anim, text="Choose a color", fill=INK, font=self.font(26 * anim))
        for i, name in enumerate(COLORS):
            bx = cx + (i - 1.5) * 108 * anim
            by = cy + 14 * anim
            h = self.color_anim[name]
            r = (36 + 6 * h) * anim
            col = COLOR_HEX[name]
            c.create_oval(bx - r - 7, by - r - 7, bx + r + 7, by + r + 7,
                          fill=mix("#1b2c35", col, 0.18 + 0.3 * h), outline="")
            c.create_oval(bx - r, by - r + 3, bx + r, by + r + 3, fill="#0a1217", outline="")
            c.create_oval(bx - r, by - r, bx + r, by + r, fill=col, outline="#ffffff", width=2 + h)
            c.create_oval(bx - r * 0.6, by - r * 0.85, bx + r * 0.6, by - r * 0.1,
                          fill=mix(col, "#ffffff", 0.2), outline="")
            c.create_text(bx, by + r + 18 * anim, text=name.upper(), fill=mix(MUTED, INK, h), font=self.font(12))
            self.color_boxes[name] = (bx - r, by - r, bx + r, by + r)

    def draw_winner(self) -> None:
        c = self.canvas
        age = self.t - self.win_time
        ov = ease_out(age / 0.5)
        self.dim_overlay(ov * 0.6)
        you = self.winner == "player"
        # re-draw confetti on top of the dim layer
        self.draw_particles()
        e = ease_out_back((age - 0.15) / 0.5)
        opponent = self.remote_name if self.network_mode else "CPU"
        title = "YOU WIN!" if you else f"{opponent[:14]} WINS"
        col = GOLD if you else INK
        size = max(8.0, 92 * e)
        f = self.font(size, "bold", "italic")
        y = self.H / 2 - 50 + math.sin(self.t * 3) * 4
        c.create_text(self.cx + 4, y + 6, text=title, font=f, fill="#05090d")
        c.create_text(self.cx, y, text=title, font=f, fill=col)
        if age > 0.35:
            sub = "A perfect hand." if you else "Fancy a rematch?"
            c.create_text(self.cx, y + 66, text=sub, font=self.font(18, "normal"),
                          fill=mix("#101820", MUTED, ease_out((age - 0.35) / 0.4)))
            if age > 0.55:
                bw = 80 + 20 * ease_out((age - 0.55) / 0.3)
                self.draw_button("restart", self.cx - bw, y + 100, self.cx + bw, y + 148,
                                 "Play again", True, primary=True, pulse=True)


def main() -> None:
    try:  # crisp rendering on Windows high-DPI displays
        import ctypes
        ctypes.windll.shcore.SetProcessDpiAwareness(1)  # type: ignore[attr-defined]
    except Exception:
        pass
    root = tk.Tk()
    UnoGame(root)
    root.mainloop()


if __name__ == "__main__":
    main()
