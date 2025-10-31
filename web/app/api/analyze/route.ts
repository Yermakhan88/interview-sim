// web/app/api/analyze/route.ts
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

// GET арқылы тест: http://localhost:3001/api/analyze
export async function GET() {
  return NextResponse.json({ ok: true, route: 'analyze' });
}

// POST → Render backend-ке жібереді
export async function POST(req: NextRequest) {
  try {
    const backend = process.env.NEXT_PUBLIC_API_URL!;
    const fd = await req.formData();

    const r = await fetch(`${backend}/api/analyze`, {
      method: 'POST',
      body: fd,
    });

    const text = await r.text();

    return new NextResponse(text, {
      status: r.status,
      headers: { 'Content-Type': r.headers.get('content-type') || 'application/json' },
    });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
