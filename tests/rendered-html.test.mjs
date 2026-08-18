import assert from "node:assert/strict";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://keycalendar.test${pathname}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the KeyCalendar workspace", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>KeyCalendar<\/title>/i);
  assert.match(html, /Шахматка/);
  assert.match(html, /Новое бронирование/);
  assert.match(html, /Nevsky Residence/);
  assert.match(html, /Все каналы синхронизированы/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|react-loading-skeleton/i);
  assert.match(html, /og\.png/);
});

test("server-renders the financial analytics workspace", async () => {
  const response = await render("/finance");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Финансовая аналитика/);
  assert.match(html, /Расчёты с собственниками/);
  assert.match(html, /Доходность портфеля/);
  assert.match(html, /Начисление/);
});

test("server-renders the public direct-booking page", async () => {
  const response = await render("/booking");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Пространства, куда хочется возвращаться/);
  assert.match(html, /Найти варианты/);
  assert.match(html, /ЮKassa/);
  assert.match(html, /CloudPayments/);
});
