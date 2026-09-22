import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { Server as SocketIOServer, type Socket } from "socket.io";
import { decode } from "next-auth/jwt";
import { db } from "./src/lib/db";

const dev = process.env.NODE_ENV !== "production";
// Bindeadresse im Container, nicht die oeffentliche Adresse.
const bindAdresse = "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

// Next bekommt hier bewusst keine Adresse: hinter dem Reverse Proxy steht die
// echte Domain im Host-Kopf. Nennt man Next "0.0.0.0", haelt es das fuer die
// eigene Adresse und schickt Weiterleitungen - etwa nach dem Abmelden - an
// https://0.0.0.0:3000 statt an die Domain.
const app = next({ dev });
const handle = app.getRequestHandler();

// Die Session steckt im NextAuth-Cookie. Hinter HTTPS heisst es "__Secure-...".
const SESSION_COOKIES = [
  "__Secure-authjs.session-token",
  "authjs.session-token",
];

type SocketSession = { userId: string; orgId: string };

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) return [part, ""];
        return [
          part.slice(0, index),
          decodeURIComponent(part.slice(index + 1)),
        ];
      })
  );
}

/**
 * Prueft das Session-Cookie des Clients und ermittelt die Organisation.
 * Ohne gueltige Session kommt keine Socket-Verbindung zustande.
 */
async function authenticate(socket: Socket): Promise<SocketSession | null> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;

  const cookies = parseCookies(socket.handshake.headers.cookie);

  for (const name of SESSION_COOKIES) {
    const token = cookies[name];
    if (!token) continue;

    try {
      // salt entspricht in NextAuth v5 dem Cookie-Namen.
      const payload = await decode({ token, secret, salt: name });
      const userId = payload?.id as string | undefined;
      if (!userId) continue;

      const member = await db.organizationMember.findFirst({
        where: { userId, isActive: true },
        select: { organizationId: true },
      });
      if (!member) continue;

      return { userId, orgId: member.organizationId };
    } catch {
      // Ungueltiges oder abgelaufenes Token -> naechstes Cookie probieren.
    }
  }

  return null;
}

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  const io = new SocketIOServer(httpServer, {
    path: "/api/ws",
    // Gleiche Herkunft wie die App - keine fremden Webseiten.
    cors: { origin: false },
  });

  const sessions = new WeakMap<Socket, SocketSession>();

  io.use(async (socket, nextFn) => {
    const session = await authenticate(socket);
    if (!session) {
      nextFn(new Error("Nicht angemeldet"));
      return;
    }
    sessions.set(socket, session);
    nextFn();
  });

  io.on("connection", (socket) => {
    const session = sessions.get(socket)!;

    // Jeder landet automatisch im Raum seiner eigenen Organisation.
    socket.join(`org:${session.orgId}`);

    // ---- Room management ----

    socket.on("join:org", (orgId: string) => {
      // Fremde Organisationen sind tabu.
      if (orgId !== session.orgId) return;
      socket.join(`org:${orgId}`);
    });

    socket.on("join:schedule", async (scheduleId: string) => {
      if (typeof scheduleId !== "string") return;
      const schedule = await db.schedule.findFirst({
        where: { id: scheduleId, organizationId: session.orgId },
        select: { id: true },
      });
      if (!schedule) return;
      socket.join(`schedule:${scheduleId}`);
    });

    socket.on("leave:schedule", (scheduleId: string) => {
      if (typeof scheduleId !== "string") return;
      socket.leave(`schedule:${scheduleId}`);
    });

    // ---- Live-mode events (forwarded to schedule room) ----
    // Nur weiterleiten, wenn der Client wirklich in diesem Raum ist.

    function inScheduleRoom(scheduleId: unknown): scheduleId is string {
      return (
        typeof scheduleId === "string" &&
        socket.rooms.has(`schedule:${scheduleId}`)
      );
    }

    socket.on("live:started", (data: { scheduleId: string }) => {
      if (!inScheduleRoom(data?.scheduleId)) return;
      socket.to(`schedule:${data.scheduleId}`).emit("live:started", data);
    });

    socket.on("live:stopped", (data: { scheduleId: string }) => {
      if (!inScheduleRoom(data?.scheduleId)) return;
      socket.to(`schedule:${data.scheduleId}`).emit("live:stopped", data);
    });

    socket.on(
      "live:booking",
      (data: {
        scheduleId: string;
        shiftId: string;
        userId: string;
        action: string;
      }) => {
        if (!inScheduleRoom(data?.scheduleId)) return;
        socket.to(`schedule:${data.scheduleId}`).emit("live:booking", data);
      }
    );
  });

  (globalThis as Record<string, unknown>).__socketIO = io;

  httpServer.listen(port, bindAdresse, () => {
    console.log(`> Ready on http://${bindAdresse}:${port}`);
  });
});
