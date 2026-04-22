/*
 * duck weather — interface scaffold
 * -----------------------------------------------------------------------------
 */

// -----------------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------------

const LOCATION = {
  name: "boston",
  latitude: 42.3601,
  longitude: -71.0589,
  timezone: "America/New_York",
};

const DUCK_RANGES = [
  { max: 32, file: "duck_below_32.png", label: "freezing" },   // below 32°F (winter coat duck)
  { max: 50, file: "duck_32_50.png", label: "cold" },          // 32–49°F (scarf duck)
  { max: 76, file: "duck_50_75.png", label: "mild" },          // 50–75°F (musical duck)
  { max: 200, file: "duck_76_plus.png", label: "hot" },        // 76°F+ (propeller hat duck)
];

const WEATHER_CODES = {
  0: { text: "clear skies", icon: "☀️" },
  1: { text: "mostly sunny", icon: "🌤️" },
  2: { text: "partly cloudy", icon: "⛅" },
  3: { text: "overcast", icon: "☁️" },
  45: { text: "foggy", icon: "🌫️" },
  48: { text: "foggy", icon: "🌫️" },
  51: { text: "light drizzle", icon: "🌦️" },
  53: { text: "drizzle", icon: "🌦️" },
  55: { text: "heavy drizzle", icon: "🌧️" },
  61: { text: "light rain", icon: "🌧️" },
  63: { text: "rain", icon: "🌧️" },
  65: { text: "heavy rain", icon: "🌧️" },
  71: { text: "light snow", icon: "🌨️" },
  73: { text: "snow", icon: "🌨️" },
  75: { text: "heavy snow", icon: "❄️" },
  77: { text: "snow grains", icon: "🌨️" },
  80: { text: "rain showers", icon: "🌦️" },
  81: { text: "rain showers", icon: "🌧️" },
  82: { text: "violent showers", icon: "⛈️" },
  85: { text: "snow showers", icon: "🌨️" },
  86: { text: "heavy snow showers", icon: "❄️" },
  95: { text: "thunderstorm", icon: "⛈️" },
  96: { text: "storm + hail", icon: "⛈️" },
  99: { text: "storm + hail", icon: "⛈️" },
};

// -----------------------------------------------------------------------------
// DOM
// -----------------------------------------------------------------------------

const els = {
  unitToggle: document.getElementById("unitToggle"),
  unitLabel: document.getElementById("unitLabel"),
  locationChip: document.getElementById("locationChip"),
  locationLabel: document.getElementById("locationLabel"),
  notifyToggle: document.getElementById("notifyToggle"),
  bellIcon: document.getElementById("bellIcon"),

  duckImage: document.getElementById("duckImage"),
  duckPlaceholder: document.getElementById("duckPlaceholder"),

  tempGraph: document.getElementById("tempGraph"),

  dayTitle: document.getElementById("dayTitle"),
  dateLabel: document.getElementById("dateLabel"),
  tempValue: document.getElementById("tempValue"),
  descLabel: document.getElementById("descLabel"),
  highLabel: document.getElementById("highLabel"),
  lowLabel: document.getElementById("lowLabel"),
  windLabel: document.getElementById("windLabel"),

  forecastList: document.getElementById("forecastList"),
};

// -----------------------------------------------------------------------------
// State
// -----------------------------------------------------------------------------

let unit = localStorage.getItem("duck.unit") || "F";
let lastData = null;
let selectedDayIndex = 0; // 0 = today, 1 = tomorrow, etc.

// -----------------------------------------------------------------------------
// Boot
// -----------------------------------------------------------------------------

init();

function init() {
  els.unitLabel.textContent = `°${unit}`;
  els.locationLabel.textContent = LOCATION.name;

  els.unitToggle.addEventListener("click", () => {
    unit = unit === "F" ? "C" : "F";
    localStorage.setItem("duck.unit", unit);
    els.unitLabel.textContent = `°${unit}`;
    if (lastData) {
      renderForecast(lastData.daily);
      selectDay(selectedDayIndex);
    }
  });

  els.locationChip.addEventListener("click", () => {
    alert("location picker coming soon — showing boston for now.");
  });

  els.notifyToggle.addEventListener("click", handleNotifyClick);

  els.forecastList.addEventListener("click", (e) => {
    const row = e.target.closest(".row");
    if (!row) return;
    const idx = parseInt(row.getAttribute("data-index"), 10);
    selectDay(idx);
  });

  loadWeather().catch((err) => {
    console.error(err);
    els.descLabel.textContent = "couldn’t load weather :(";
  });
}

// -----------------------------------------------------------------------------
// Weather API
// -----------------------------------------------------------------------------

async function loadWeather() {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", LOCATION.latitude);
  url.searchParams.set("longitude", LOCATION.longitude);
  url.searchParams.set("timezone", LOCATION.timezone);
  url.searchParams.set("current", "temperature_2m,weather_code,wind_speed_10m");
  url.searchParams.set("hourly", "temperature_2m");
  url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,wind_speed_10m_max");
  url.searchParams.set("forecast_days", "6");
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("wind_speed_unit", "ms");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const data = await res.json();
  lastData = data;
  
  renderForecast(data.daily);
  selectDay(0); // Select today by default
}

// -----------------------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------------------

function selectDay(index) {
  if (!lastData) return;
  selectedDayIndex = index;

  const cur = lastData.current;
  const daily = lastData.daily;
  const hourly = lastData.hourly;

  // Update active state in forecast list
  const rows = els.forecastList.querySelectorAll(".row");
  rows.forEach((row, i) => {
    row.classList.toggle("active", i === index);
  });

  // Date parsing
  const d = new Date(daily.time[index] + "T00:00:00");
  const dayName = d.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
  
  els.dayTitle.textContent = index === 0 ? "today" : dayName;
  els.dateLabel.textContent = d.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toLowerCase();

  // Determine which data to use based on whether we're looking at today or the future
  let tempF, code, hiF, loF, wind;

  if (index === 0) {
    // Today: use current live data for temp/wind/code, but daily for H/L
    tempF = cur.temperature_2m;
    code = cur.weather_code;
    wind = cur.wind_speed_10m;
  } else {
    // Future: use the daily max for the big temp and duck, and daily max wind
    tempF = daily.temperature_2m_max[index];
    code = daily.weather_code[index];
    wind = daily.wind_speed_10m_max[index];
  }

  hiF = daily.temperature_2m_max[index];
  loF = daily.temperature_2m_min[index];

  // Update DOM
  els.tempValue.textContent = Math.round(convertTemp(tempF));
  
  const condition = WEATHER_CODES[code] || { text: "—", icon: "" };
  els.descLabel.textContent = `${condition.icon} ${condition.text}`.trim();
  els.highLabel.textContent = `${Math.round(convertTemp(hiF))}°`;
  els.lowLabel.textContent = `${Math.round(convertTemp(loF))}°`;
  els.windLabel.textContent = `${wind.toFixed(1)} m/s`;

  renderDuck(tempF, code);
  renderGraph(hourly, index);
}

function renderDuck(tempF, code) {
  // Weather codes for drizzle, rain, showers, and thunderstorms
  const rainCodes = [51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99];
  
  let file, label;
  
  if (rainCodes.includes(code)) {
    file = "duck_rain.png";
    label = "rainy";
  } else {
    const bucket = DUCK_RANGES.find((r) => tempF < r.max) || DUCK_RANGES[DUCK_RANGES.length - 1];
    file = bucket.file;
    label = bucket.label;
  }
  
  const src = `assets/ducks/${file}`;

  const probe = new Image();
  probe.onload = () => {
    els.duckImage.src = src;
    els.duckImage.alt = `duck dressed for ${label} weather`;
    els.duckImage.classList.add("is-visible");
    els.duckPlaceholder.style.display = "none";
  };
  probe.onerror = () => {
    els.duckImage.classList.remove("is-visible");
    els.duckPlaceholder.style.display = "grid";
    els.duckPlaceholder.querySelector("p").textContent = `duck: ${label} (${file})`;
  };
  probe.src = src;
}

function renderGraph(hourly, dayIndex) {
  const svg = els.tempGraph;
  const W = 300;
  const H = 90;
  const PAD = 6;

  // Grab the 24 hours for the selected day (00:00 to 23:00)
  const startIdx = dayIndex * 24;
  const slice = hourly.temperature_2m.slice(startIdx, startIdx + 24);
  if (slice.length < 2) return;

  const min = Math.min(...slice);
  const max = Math.max(...slice);
  const range = Math.max(1, max - min);

  const points = slice.map((t, i) => {
    const x = PAD + (i / (slice.length - 1)) * (W - PAD * 2);
    const y = H - PAD - ((t - min) / range) * (H - PAD * 2);
    return [x, y];
  });

  const path = points
    .map(([x, y], i) => (i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`))
    .join(" ");

  svg.innerHTML = `
    <path d="${path}" fill="none" stroke="#86c9a6" stroke-width="3"
      stroke-linecap="round" stroke-linejoin="round" />
  `;
}

function renderForecast(daily) {
  const rows = [];
  for (let i = 0; i < daily.time.length; i += 1) {
    const d = new Date(daily.time[i] + "T00:00:00");
    const day = d.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
    const code = daily.weather_code[i];
    const icon = (WEATHER_CODES[code] || {}).icon || "";
    const hi = Math.round(convertTemp(daily.temperature_2m_max[i]));
    const lo = Math.round(convertTemp(daily.temperature_2m_min[i]));
    
    rows.push(`
      <div class="row" data-index="${i}" role="button" tabindex="0" aria-label="View weather for ${day}">
        <span class="day">${i === 0 ? "today" : day}</span>
        <span class="icon">${icon}</span>
        <span class="range">${hi}° / ${lo}°</span>
      </div>
    `);
  }
  els.forecastList.innerHTML = rows.join("");
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function convertTemp(fahrenheit) {
  return unit === "F" ? fahrenheit : (fahrenheit - 32) * (5 / 9);
}

async function handleNotifyClick() {
  if (!("Notification" in window)) {
    alert("your browser doesn’t support notifications.");
    return;
  }
  if (Notification.permission === "granted") {
    els.bellIcon.textContent = "🔕";
    alert("notifications already enabled. (we’ll wire daily alerts later.)");
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm === "granted") {
    els.bellIcon.textContent = "🔕";
    new Notification("duck weather", {
      body: "notifications on — duck will say hi each morning 🦆",
    });
  }
}
