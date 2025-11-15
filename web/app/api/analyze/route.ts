import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Тест: GET /api/analyze → {"ok":true,"route":"analyze"}
export async function GET() {
  return NextResponse.json({ ok: true, route: 'analyze' });
}

// Proxy POST → Render backend (https://interview-sim-ds4z.onrender.com)
export async function POST(req: NextRequest) {
  try {
    const backend = process.env.NEXT_PUBLIC_API_URL;
    if (!backend) {
      return NextResponse.json(
        { error: 'Missing NEXT_PUBLIC_API_URL on frontend' },
        { status: 500 }
      );
    }

    const form = await req.formData();

    // сол form-ды backend-ке жібереміз (audio + lang бар)
    const r = await fetch(`${backend}/api/analyze`, {
      method: 'POST',
      body: form,
    });

    const text = await r.text();

    return new NextResponse(text, {
      status: r.status,
      headers: {
        'Content-Type': r.headers.get('content-type') || 'application/json',
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        error: 'proxy_error',
        detail: e?.message || String(e),
      },
      { status: 500 }
    );
  }
}
