// Avoid a curl dependency in the application image.
try {
  const response = await fetch(`http://127.0.0.1:${process.env.PORT}/health`, {
    signal: AbortSignal.timeout(3000),
  });
  const body = await response.json();
  if (!response.ok || body.status !== 'ok' || body.database !== 'up') process.exitCode = 1;
} catch {
  process.exitCode = 1;
}
