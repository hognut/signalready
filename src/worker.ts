import type { SSRManifest } from 'astro';
import { App } from 'astro/app';
import { handle } from '@astrojs/cloudflare/handler';
import { DurableObject } from 'cloudflare:workers';

type VisitorCounterEnvironment = Env & {
	[key: string]: unknown;
	VISITOR_COUNTER: DurableObjectNamespace<VisitorCounter>;
};

const counterName = 'signal-ready-total-visits';
const visitCookieName = 'sr_visit_counted';
const oneDayInSeconds = 60 * 60 * 24;

export class VisitorCounter extends DurableObject {
	async fetch(request: Request): Promise<Response> {
		const currentCount = (await this.ctx.storage.get<number>('count')) ?? 0;
		const count = request.method === 'POST' ? currentCount + 1 : currentCount;

		if (request.method === 'POST') {
			await this.ctx.storage.put('count', count);
		}

		return Response.json({ count });
	}
}

const hasVisitCookie = (request: Request) => request.headers
	.get('cookie')
	?.split(';')
	.some((cookie) => cookie.trim().startsWith(`${visitCookieName}=`)) ?? false;

const visitorCountResponse = async (request: Request, env: VisitorCounterEnvironment) => {
	if (request.method !== 'GET' && request.method !== 'POST') {
		return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, POST' } });
	}

	const requestUrl = new URL(request.url);
	const requestOrigin = request.headers.get('origin');
	if (request.method === 'POST' && requestOrigin && requestOrigin !== requestUrl.origin) {
		return new Response('Forbidden', { status: 403 });
	}

	const shouldIncrement = request.method === 'POST' && !hasVisitCookie(request);
	const counterId = env.VISITOR_COUNTER.idFromName(counterName);
	const counter = env.VISITOR_COUNTER.get(counterId);
	const counterResponse = await counter.fetch('https://visitor-counter.internal/', {
		method: shouldIncrement ? 'POST' : 'GET',
	});
	const payload = await counterResponse.text();
	const headers = new Headers({
		'Cache-Control': 'no-store',
		'Content-Type': 'application/json; charset=utf-8',
	});

	if (shouldIncrement) {
		headers.append(
			'Set-Cookie',
			`${visitCookieName}=1; Max-Age=${oneDayInSeconds}; Path=/; HttpOnly; Secure; SameSite=Lax`,
		);
	}

	return new Response(payload, { status: counterResponse.status, headers });
};

export function createExports(manifest: SSRManifest) {
	const app = new App(manifest);

	return {
		default: {
			async fetch(request, env, context) {
				if (new URL(request.url).pathname === '/api/visits') {
					return visitorCountResponse(request, env);
				}

				return handle(
					manifest,
					app,
					request as unknown as Parameters<typeof handle>[2],
					env as unknown as Parameters<typeof handle>[3],
					context as Parameters<typeof handle>[4],
				);
			},
		} satisfies ExportedHandler<VisitorCounterEnvironment>,
		VisitorCounter,
	};
}
