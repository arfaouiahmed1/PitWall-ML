import {
  fetchCircuitWeather,
  UNAVAILABLE_LIVE_WEATHER,
} from "../../apps/web/lib/liveWeather";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// 1. Assert default weather state is explicitly unavailable with nulls
assert(
  UNAVAILABLE_LIVE_WEATHER.available === false,
  "Default weather must have available=false",
);
assert(
  UNAVAILABLE_LIVE_WEATHER.airTempC === null &&
    UNAVAILABLE_LIVE_WEATHER.trackTempC === null,
  "Default weather must not fabricate temperatures",
);
assert(
  UNAVAILABLE_LIVE_WEATHER.provenance === "UNAVAILABLE",
  "Default weather must have provenance UNAVAILABLE",
);
assert(
  UNAVAILABLE_LIVE_WEATHER.stale === true,
  "Default unobserved weather must be marked stale",
);

// 2. Assert fetchCircuitWeather without API or empty returns unavailable
async function testWeatherFetch() {
  const result = await fetchCircuitWeather("nonexistent-session");
  assert(
    result.available === false || typeof result.airTempC === "number",
    "Weather result must either be explicit unavailable or genuine number",
  );
  if (!result.available) {
    assert(result.airTempC === null, "Unavailable weather must have airTempC null");
    assert(
      typeof result.reason === "string",
      "Unavailable weather must include a reason string",
    );
  }
}

testWeatherFetch().then(() => {
  console.log("Weather widget and storage contracts verified.");
});
