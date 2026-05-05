export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let backendOk = false;
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/health`, {
      cache: "no-store",
    });
    backendOk = res.ok;
  } catch {
    backendOk = false;
  }

  return Response.json({
    status: "ok",
    backend: backendOk,
    timestamp: new Date().toISOString(),
  });
}
