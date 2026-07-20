import { requireUser, unauthorized } from '@/lib/apiAuth';

export const dynamic = 'force-dynamic';

type BusEvent = { ts: string; project: string; type: string; agent: string | null; data: unknown };

/**
 * SSE stream of the event bus, filtered per tenant (?project=). Global events
 * (project "*", e.g. registry.updated) are always forwarded. The dashboard
 * uses this single stream for badges, live logs, notifications and refreshes.
 */
export async function GET(request: Request) {
  const { sys, user } = await requireUser(request);
  if (!user) return unauthorized();
  const project = new URL(request.url).searchParams.get('project');

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let open = true;
      const send = (chunk: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          open = false;
        }
      };
      send(`data: ${JSON.stringify({ ts: new Date().toISOString(), project: project || '*', type: 'sse.connected', agent: null, data: { user: user.username } })}\n\n`);
      const unsubscribe = sys.bus.subscribe((evt: BusEvent) => {
        if (!project || evt.project === project || evt.project === '*') {
          send(`data: ${JSON.stringify(evt)}\n\n`);
        }
      });
      const heartbeat = setInterval(() => send(': ping\n\n'), 25000);
      request.signal.addEventListener('abort', () => {
        open = false;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
