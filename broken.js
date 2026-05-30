//
// MLB HR PROP ENGINE — v31 (Dual DK Endpoint: Pre-game + Live)
// 2026-05-30
//
// ROOT CAUSE FOUND & FIXED:
//   DK uses label "1+" for PRE-GAME HR props.
//   Once a game goes LIVE, DK switches to "2+" markets (2+ HRs).
//   The script was filtering to "1+" only, so all 8 live games
//   with active "2+" lines showed "No DK HR lines found."
//
// PATCHES FROM v29:
//   FIX v30-A — Accept "1+", "2+", AND "3+" labels from DK.
//               Each stored as separate book entry ("DK 1+", "DK 2+")
//               so output clearly shows which market type is active.
//               seenKey is now "playerName|label" so a player can have
//               both a pre-game 1+ line and a live 2+ line simultaneously.
//   FIX v30-B — normalizeName() now strips parenthetical team qualifiers
//               e.g. DK="Will Smith (LAD)" → normalized "will smith"
//               matches roster "Will Smith" correctly.
//   FIX v30-C — normalizeName() now collapses dotted initials:
//               "T.J." → "tj" matches roster "T.J. Rumfield" → "tj rumfield".
//               Also fixes "Jazz Chisholm" (no suffix issue, likely a
//               roster timing miss — normalization covers edge cases).
//   FIX v30-D — bookShort() updated for new label format.
//   RETAINED   — All v29/v28/v27/v26 patches.
//

// ======================================================
// CONFIG
// ======================================================

const OPENWEATHER_API_KEY = "3b1c666e88254b0827f0f37e326aa46f"
const TODAY_YEAR = new Date().getFullYear()

// ======================================================
// DRAFTKINGS DIRECT API CONFIG
// ======================================================

const DK_LEAGUE_ID           = "84240"
const DK_HR_SUBCATEGORY      = "17319"   // Pre-game: Batter Home Runs (1+)
const DK_HR_LIVE_SUBCATEGORY = "17553"   // In-game:  Batter Home Runs live (2+)
const DK_SITE                = "US-PA-SB"

// Map each subcategory to its proper DK web referer path
const DK_REFERER_MAP = {
  [DK_HR_SUBCATEGORY]:      "https://sportsbook.draftkings.com/leagues/baseball/mlb?category=games&subcategory=batter-props&nav_1=home-runs",
  [DK_HR_LIVE_SUBCATEGORY]: "https://sportsbook.draftkings.com/leagues/baseball/mlb?category=games&subcategory=live-batter-props&nav_1=home-runs",
}

function buildDKHRUrl(subCatId) {
  let evQ = encodeURIComponent(
    "$filter=leagueId eq '" + DK_LEAGUE_ID + "' AND " +
    "clientMetadata/Subcategories/any(s: s/Id eq '" + subCatId + "')"
  )
  let mkQ = encodeURIComponent(
    "$filter=clientMetadata/subCategoryId eq '" + subCatId + "' AND " +
    "tags/all(t: t ne 'SportcastBetBuilder')"
  )
  let tvQ = encodeURIComponent(DK_LEAGUE_ID + "," + subCatId)
  return (
    "https://sportsbook-nash.draftkings.com/sites/" + DK_SITE +
    "/api/sportscontent/controldata/league/leagueSubcategory/v1/markets" +
    "?isBatchable=false&templateVars=" + tvQ +
    "&eventsQuery=" + evQ +
    "&marketsQuery=" + mkQ +
    "&include=Events&entity=events"
  )
}

async function fetchDKRaw(subCatId) {
  let req = new Request(buildDKHRUrl(subCatId))
  req.method = "GET"

  // Use the correct referer for whichever subcategory we're hitting
  let referer = DK_REFERER_MAP[subCatId] ||
    "https://sportsbook.draftkings.com/leagues/baseball/mlb?category=games&subcategory=batter-props&nav_1=home-runs"

  req.headers = {
    "Accept":           "application/json, text/plain, */*",
    "Accept-Language":  "en-US,en;q=0.9",
    "Origin":           "https://sportsbook.draftkings.com",
    "Referer":          referer,
    "User-Agent":       "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
  }

  let resp = await req.loadString()
  let status = req.response ? req.response.statusCode : 0
  if (status !== 200) throw new Error("DK HTTP " + status + " (subcat " + subCatId + ")")
  return JSON.parse(resp)
}


// Fetch both pre-game and live subcategories, merge into one response object
async function fetchDKHRData() {
  let preGame = { events: [], markets: [], selections: [] }
  let inGame  = { events: [], markets: [], selections: [] }

  try { preGame = await fetchDKRaw(DK_HR_SUBCATEGORY)      } catch(e) { console.log("DK pre-game fetch error: " + e) }
  try { inGame  = await fetchDKRaw(DK_HR_LIVE_SUBCATEGORY) } catch(e) { console.log("DK in-game fetch error: " + e)  }

  return {
    events:     [...(preGame.events     || []), ...(inGame.events     || [])],
    markets:    [...(preGame.markets    || []), ...(inGame.markets    || [])],
    selections: [...(preGame.selections || []), ...(inGame.selections || [])],
  }
}

// ======================================================
// STADIUM COORDINATES
// ======================================================

const stadiumCoords = {
  "Arizona Diamondbacks":  { lat: 33.4453,  lon: -112.0667 },
  "Atlanta Braves":        { lat: 33.8907,  lon: -84.4677  },
  "Baltimore Orioles":     { lat: 39.2838,  lon: -76.6218  },
  "Boston Red Sox":        { lat: 42.3467,  lon: -71.0972  },
  "Chicago Cubs":          { lat: 41.9484,  lon: -87.6553  },
  "Chicago White Sox":     { lat: 41.8299,  lon: -87.6338  },
  "Cincinnati Reds":       { lat: 39.0979,  lon: -84.5082  },
  "Cleveland Guardians":   { lat: 41.4962,  lon: -81.6852  },
  "Colorado Rockies":      { lat: 39.7559,  lon: -104.9942 },
  "Detroit Tigers":        { lat: 42.3390,  lon: -83.0485  },
  "Houston Astros":        { lat: 29.7573,  lon: -95.3555  },
  "Kansas City Royals":    { lat: 39.0517,  lon: -94.4803  },
  "Los Angeles Angels":    { lat: 33.8003,  lon: -117.8827 },
  "Los Angeles Dodgers":   { lat: 34.0739,  lon: -118.2400 },
  "Miami Marlins":         { lat: 25.7781,  lon: -80.2197  },
  "Milwaukee Brewers":     { lat: 43.0280,  lon: -87.9712  },
  "Minnesota Twins":       { lat: 44.9817,  lon: -93.2776  },
  "New York Mets":         { lat: 40.7571,  lon: -73.8458  },
  "New York Yankees":      { lat: 40.8296,  lon: -73.9262  },
  "Athletics":             { lat: 38.5802,  lon: -121.4687 },
  "Oakland Athletics":     { lat: 38.5802,  lon: -121.4687 },
  "Philadelphia Phillies": { lat: 39.9061,  lon: -75.1665  },
  "Pittsburgh Pirates":    { lat: 40.4469,  lon: -80.0057  },
  "San Diego Padres":      { lat: 32.7076,  lon: -117.1570 },
  "Seattle Mariners":      { lat: 47.5914,  lon: -122.3325 },
  "San Francisco Giants":  { lat: 37.7786,  lon: -122.3893 },
  "St. Louis Cardinals":   { lat: 38.6226,  lon: -90.1928  },
  "Tampa Bay Rays":        { lat: 27.7682,  lon: -82.6534  },
  "Texas Rangers":         { lat: 32.7512,  lon: -97.0832  },
  "Toronto Blue Jays":     { lat: 43.6414,  lon: -79.3894  },
  "Washington Nationals":  { lat: 38.8730,  lon: -77.0074  },
}

// ======================================================
// ABBR ↔ FULL NAME MAPS
// ======================================================

const rotoAbbrToFull = {
  "ARI":"Arizona Diamondbacks","ATL":"Atlanta Braves","BAL":"Baltimore Orioles",
  "BOS":"Boston Red Sox","CHC":"Chicago Cubs","CWS":"Chicago White Sox",
  "CIN":"Cincinnati Reds","CLE":"Cleveland Guardians","COL":"Colorado Rockies",
  "DET":"Detroit Tigers","HOU":"Houston Astros","KC":"Kansas City Royals",
  "LAA":"Los Angeles Angels","LAD":"Los Angeles Dodgers","MIA":"Miami Marlins",
  "MIL":"Milwaukee Brewers","MIN":"Minnesota Twins","NYM":"New York Mets",
  "NYY":"New York Yankees","ATH":"Athletics","PHI":"Philadelphia Phillies",
  "PIT":"Pittsburgh Pirates","SD":"San Diego Padres","SEA":"Seattle Mariners",
  "SF":"San Francisco Giants","STL":"St. Louis Cardinals","TB":"Tampa Bay Rays",
  "TEX":"Texas Rangers","TOR":"Toronto Blue Jays","WSH":"Washington Nationals",
}

const fullToRotoAbbr = {}
for (let abbr in rotoAbbrToFull) fullToRotoAbbr[rotoAbbrToFull[abbr]] = abbr
fullToRotoAbbr["Oakland Athletics"] = "ATH"

const rotoAbbrToMlbId = {
  "ARI":109,"ATL":144,"BAL":110,"BOS":111,"CHC":112,"CWS":145,"CIN":113,
  "CLE":114,"COL":115,"DET":116,"HOU":117,"KC":118,"LAA":108,"LAD":119,
  "MIA":146,"MIL":158,"MIN":142,"NYM":121,"NYY":147,"ATH":133,"PHI":143,
  "PIT":134,"SD":135,"SEA":136,"SF":137,"STL":138,"TB":139,"TEX":140,
  "TOR":141,"WSH":120,
}

// ======================================================
// FIX 5 — EXPANDED DK TEAM NAME ALIASES
// DK uses many alternate forms: city-only, nickname-only, abbreviations, etc.
// ======================================================

const dkTeamAliases = {
  // Nickname only
  "diamondbacks":   "ARI", "d-backs":        "ARI",
  "braves":         "ATL",
  "orioles":        "BAL", "o's":            "BAL",
  "red sox":        "BOS",
  "cubs":           "CHC",
  "white sox":      "CWS",
  "reds":           "CIN",
  "guardians":      "CLE",
  "rockies":        "COL",
  "tigers":         "DET",
  "astros":         "HOU",
  "royals":         "KC",
  "angels":         "LAA",
  "dodgers":        "LAD",
  "marlins":        "MIA",
  "brewers":        "MIL",
  "twins":          "MIN",
  "mets":           "NYM",
  "yankees":        "NYY",
  "athletics":      "ATH", "a's":            "ATH", "oakland athletics": "ATH",
  "phillies":       "PHI",
  "pirates":        "PIT",
  "padres":         "SD",
  "mariners":       "SEA",
  "giants":         "SF",
  "cardinals":      "STL",
  "rays":           "TB",
  "rangers":        "TEX",
  "blue jays":      "TOR",
  "nationals":      "WSH", "nats":           "WSH",
  // City only (common DK forms)
  "arizona":        "ARI",
  "atlanta":        "ATL",
  "baltimore":      "BAL",
  "boston":         "BOS",
  "chicago":        null,  // ambiguous — need nickname to disambiguate
  "cincinnati":     "CIN",
  "cleveland":      "CLE",
  "colorado":       "COL",
  "detroit":        "DET",
  "houston":        "HOU",
  "kansas city":    "KC",
  "los angeles":    null,  // ambiguous
  "miami":          "MIA",
  "milwaukee":      "MIL",
  "minnesota":      "MIN",
  "new york":       null,  // ambiguous
  "oakland":        "ATH",
  "philadelphia":   "PHI",
  "pittsburgh":     "PIT",
  "san diego":      "SD",
  "seattle":        "SEA",
  "san francisco":  "SF",
  "st. louis":      "STL", "saint louis": "STL",
  "tampa bay":      "TB",
  "texas":          "TEX",
  "toronto":        "TOR",
  "washington":     "WSH",
}

// ======================================================
// HELPERS
// ======================================================

// FIX 1+2 — improved nameMatches with suffix stripping and accent normalization
function normalizeName(n) {
  return n
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(jr\.?|sr\.?|ii|iii|iv)\b/g, "")
    // FIX v30: strip parenthetical team qualifiers DK adds to disambiguate
    // e.g. "Will Smith (LAD)" → "Will Smith"
    .replace(/\s*\([^)]*\)\s*/g, " ")
    // Normalize T.J. / A.J. style initials — strip the dots so "T.J." = "TJ"
    .replace(/\b([a-z])\.([a-z])\./g, "$1$2")
    .replace(/\s+/g, " ")
    .trim()
}

function nameMatches(a, b) {
  let av = normalizeName(a), bv = normalizeName(b)
  if (av === bv) return true

  let ap = av.split(" "), bp = bv.split(" ")

  // Single-token match: DK sometimes sends only last name
  if (ap.length === 1 && bp.length >= 2) {
    return ap[0] === bp[bp.length - 1]
  }
  if (bp.length === 1 && ap.length >= 2) {
    return bp[0] === ap[ap.length - 1]
  }

  if (ap.length < 2 || bp.length < 2) return false

  // Last name must match (handles multi-word last names)
  let aLast = ap.slice(1).join(" "), bLast = bp.slice(1).join(" ")
  if (aLast !== bLast) return false

  // First name: exact or initial match
  let aF = ap[0].replace(".", ""), bF = bp[0].replace(".", "")
  if (aF === bF) return true
  if (aF.length === 1 || bF.length === 1) return aF[0] === bF[0]
  return false
}

function windDegToDir(deg) {
  return ["N","NE","E","SE","S","SW","W","NW"][Math.round(deg/45)%8]
}
function weatherShort(wx) {
  return wx ? `${wx.windDir} ${wx.windSpeed}mph | ${wx.temp}°F` : "N/A"
}
function weatherFull(wx) {
  return wx ? `Wind: ${wx.windDir} ${wx.windSpeed}mph | Temp: ${wx.temp}°F | ${wx.desc}` : "Weather: N/A"
}
function bookShort(b) {
  if (b==="DraftKings 1+") return "DK 1+"
  if (b==="DraftKings 2+") return "DK 2+"
  if (b==="DraftKings 3+") return "DK 3+"
  if (b==="DraftKings")    return "DK"
  if (b==="BetRivers")     return "BR"
  if (b==="FanDuel")       return "FD"
  if (b==="BetMGM")        return "MGM"
  if (b==="Caesars")       return "CZR"
  if (b==="BetOnline.ag")  return "BOL"
  return b
}

// ======================================================
// FETCH PITCHER HR/9 BY ID
// ======================================================
async function fetchPitcherHr9(pitcherId, season) {
  if (!pitcherId) return "—"
  const url = `https://statsapi.mlb.com/api/v1/people/${pitcherId}/stats?stats=season&group=pitching&season=${season}`
  try {
    const data = await new Request(url).loadJSON()
    const split = data?.stats?.[0]?.splits?.[0]?.stat
    if (split && split.homeRunsPer9) {
      return parseFloat(split.homeRunsPer9).toFixed(2)
    }
    return "—"
  } catch(e) {
    return "—"
  }
}

let output = ""

// ======================================================
// STEP 1 — MLB SCHEDULE
// ======================================================

let scheduleData = await new Request(
  "https://statsapi.mlb.com/api/v1/schedule/games/?sportId=1"
).loadJSON()
let allGames = (scheduleData?.dates?.[0]?.games) || []

// FIX v29: Only show Live (in-progress) and Preview (upcoming) games.
// Final games are dropped — they're over, no action left.
let games = allGames.filter(g => {
  let state = g.status?.abstractGameState || ""
  return state === "Preview" || state === "Live"
})
console.log(`Filtered from ${allGames.length} to ${games.length} games (Preview/Live only)`)

if (games.length === 0) {
  output += "NO LIVE OR UPCOMING GAMES TODAY\n"
  QuickLook.present(output)
  return
}

// ======================================================
// STEP 1b — WEATHER
// ======================================================

let gameWeather = {}
for (let game of games) {
  let home = game.teams.home.team.name
  let coords = stadiumCoords[home]
  if (!coords) { gameWeather[home] = null; continue }
  let wxData
  try {
    let r = new Request(
      `https://api.openweathermap.org/data/2.5/weather?lat=${coords.lat}&lon=${coords.lon}&appid=${OPENWEATHER_API_KEY}&units=imperial`
    )
    wxData = await r.loadJSON()
  } catch(e) { gameWeather[home] = null; continue }
  if (!wxData?.main) { gameWeather[home] = null; continue }
  let wx = {
    temp:      Math.round(wxData.main.temp),
    windSpeed: Math.round(wxData.wind?.speed || 0),
    windDir:   windDegToDir(wxData.wind?.deg || 0),
    desc:      wxData.weather?.[0]?.description || "n/a",
  }
  gameWeather[home] = wx
  if (home==="Athletics")         gameWeather["Oakland Athletics"] = wx
  if (home==="Oakland Athletics") gameWeather["Athletics"] = wx
}

// ======================================================
// STEP 1c — SCHEDULE OUTPUT
// ======================================================

output += "============================\n"
output += "TODAY'S LIVE & UPCOMING SLATE\n"
output += "============================\n\n"
for (let g of games) {
  let away = g.teams.away.team.name, home = g.teams.home.team.name
  output += `${away} @ ${home}\n`
  output += `  ${weatherFull(gameWeather[home])}\n`
}
output += "\n"

// ======================================================
// STEP 1d — PROBABLE PITCHERS
// ======================================================

let pitcherIdMap = {}
let ppSchedule
try {
  ppSchedule = await new Request(
    "https://statsapi.mlb.com/api/v1/schedule/games/?sportId=1&hydrate=probablePitcher"
  ).loadJSON()
} catch(e) {}

if (ppSchedule?.dates?.[0]?.games) {
  for (let g of ppSchedule.dates[0].games) {
    if (!games.find(fg => fg.gamePk === g.gamePk)) continue
    let homeF = g.teams.home.team.name, awayF = g.teams.away.team.name
    let homeA = fullToRotoAbbr[homeF] || homeF
    let awayA = fullToRotoAbbr[awayF] || awayF
    let gKey = [homeA, awayA].sort().join(" vs ")
    pitcherIdMap[gKey] = {}
    for (let side of ["home","away"]) {
      let pp = g.teams[side].probablePitcher
      pitcherIdMap[gKey][side] = pp
        ? { name: pp.fullName || `${pp.firstName} ${pp.lastName}`, id: pp.id }
        : { name: "TBD", id: null }
    }
  }
}

// ======================================================
// STEP 1e — PITCHER SEASON STATS (HR/9)
// ======================================================

let pitcherStatsMap = {}
let pitcherIds = new Set()
for (let gKey in pitcherIdMap) {
  for (let side of ["home","away"]) {
    let pp = pitcherIdMap[gKey][side]
    if (pp?.id) pitcherIds.add(pp.id)
  }
}

for (let pid of pitcherIds) {
  let statsData
  try {
    statsData = await new Request(
      `https://statsapi.mlb.com/api/v1/people/${pid}/stats` +
      `?stats=season&group=pitching&season=${TODAY_YEAR}`
    ).loadJSON()
  } catch(e) { continue }

  let split = statsData?.stats?.[0]?.splits?.[0]?.stat
  if (!split) continue

  let hr = parseFloat(split.homeRuns) || 0
  let ipRaw = String(split.inningsPitched || "0")
  let ipParts = ipRaw.split(".")
  let ipFull = parseFloat(ipParts[0]) + (parseFloat(ipParts[1] || 0) / 3)

  let hr9 = ipFull > 0 ? ((hr / ipFull) * 9).toFixed(2) : "—"
  pitcherStatsMap[pid] = { hr9 }
}

// ======================================================
// STEP 1f — LIVE GAME DATA
// FIX v27-C: Use linescore.defense.pitcher for the TRUE current pitcher
//            (not the last ID in boxscore .pitchers array, which can be
//            a pinch runner or DH). Falls back to boxscore array if needed.
//            Also handles Final games (shows final score + winning/losing pitcher).
// ======================================================
async function fetchLiveGameData(gamePk) {
  try {
    const feedUrl = `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`
    const feed = await new Request(feedUrl).loadJSON()
    const linescore = feed.liveData?.linescore
    const boxscore  = feed.liveData?.boxscore
    const decisions = feed.liveData?.decisions   // winning/losing/save pitchers
    if (!linescore || !boxscore) return null

    const gameState    = feed.gameData?.status?.abstractGameState || ""
    const isFinal      = gameState === "Final"
    const isInProgress = gameState === "Live"

    // ── Score ──
    const awayRuns = linescore.teams?.away?.runs ?? 0
    const homeRuns = linescore.teams?.home?.runs ?? 0
    const score = `${awayRuns} – ${homeRuns}`

    // ── Inning / game state text ──
    let inningText = ""
    if (isFinal) {
      inningText = `FINAL`
      const totalInnings = linescore.currentInning
      if (totalInnings && totalInnings !== 9) inningText += ` (${totalInnings})`
    } else {
      const currentInning = linescore.currentInning ?? "?"
      const inningHalf    = linescore.inningHalf ?? (linescore.isTopInning ? "Top" : "Bottom")
      const outs          = linescore.outs ?? 0
      const inningState   = linescore.inningState ?? ""
      inningText = `${inningHalf} ${currentInning} (${outs} out${outs !== 1 ? "s" : ""})`
      if (inningState === "Middle") inningText += " • Mid"
      else if (inningState === "End") inningText += " • End"
    }

    // ── Current pitchers ──
    // Primary: linescore.defense.pitcher (the ACTUAL pitcher currently on the mound)
    // This is the most accurate source for in-progress games.
    const awayPlayers = boxscore.teams?.away?.players || {}
    const homePlayers = boxscore.teams?.home?.players || {}

    // Helper: get pitcher name + HR/9 by MLBAM id
    async function pitcherInfo(playerId, playerPool) {
      if (!playerId) return { name: "TBD", hr9: "—" }
      let name = playerPool[`ID${playerId}`]?.person?.fullName || "Unknown"
      let hr9  = await fetchPitcherHr9(playerId, TODAY_YEAR)
      return { name, hr9 }
    }

    let awayCurrentPitcherId = null
    let homeCurrentPitcherId = null

    if (isFinal) {
      // For final games, show the decision pitchers if available
      // "away" side = losing pitcher when home team wins, etc.
      // Simplest: just show last pitcher from each team's pitchers array
      const awayPitcherIds = boxscore.teams?.away?.pitchers || []
      const homePitcherIds = boxscore.teams?.home?.pitchers || []
      awayCurrentPitcherId = awayPitcherIds.length ? awayPitcherIds[awayPitcherIds.length - 1] : null
      homeCurrentPitcherId = homePitcherIds.length ? homePitcherIds[homePitcherIds.length - 1] : null

      // Override with decision pitchers if available (more meaningful for final)
      if (decisions?.winner?.id) {
        const winnerId = decisions.winner.id
        // Figure out which team the winner is on
        if (homePlayers[`ID${winnerId}`]) homeCurrentPitcherId = winnerId
        else if (awayPlayers[`ID${winnerId}`]) awayCurrentPitcherId = winnerId
      }
    } else {
      // FIX v27-C: use linescore.defense/offense to identify current pitcher
      // linescore.defense.pitcher is the fielding team's current pitcher
      // linescore.isTopInning: true = away batting, home pitching
      const defPitcherId = linescore.defense?.pitcher?.id
      const offTeamIsAway = linescore.isTopInning

      if (defPitcherId) {
        if (offTeamIsAway) {
          // Top of inning: away batting, home pitching
          homeCurrentPitcherId = defPitcherId
        } else {
          // Bottom of inning: home batting, away pitching
          awayCurrentPitcherId = defPitcherId
        }
      }

      // Fallback: use boxscore pitchers array last entry for the other side
      const awayPitcherIds = boxscore.teams?.away?.pitchers || []
      const homePitcherIds = boxscore.teams?.home?.pitchers || []
      if (!awayCurrentPitcherId && awayPitcherIds.length) {
        awayCurrentPitcherId = awayPitcherIds[awayPitcherIds.length - 1]
      }
      if (!homeCurrentPitcherId && homePitcherIds.length) {
        homeCurrentPitcherId = homePitcherIds[homePitcherIds.length - 1]
      }
    }

    // Fetch pitcher info (name + HR/9) for both sides
    let [awayPInfo, homePInfo] = await Promise.all([
      pitcherInfo(awayCurrentPitcherId, awayPlayers),
      pitcherInfo(homeCurrentPitcherId, homePlayers),
    ])

    return {
      score,
      inning:       inningText,
      isFinal,
      awayPitcher:  awayPInfo.name,
      homePitcher:  homePInfo.name,
      awayHr9:      awayPInfo.hr9,
      homeHr9:      homePInfo.hr9,
    }
  } catch(e) {
    console.log(`fetchLiveGameData error (gamePk ${gamePk}): ${e}`)
    return null
  }
}

// ======================================================
// STEP 2 — BUILD PLAYER ROSTER MAP
// FIX 3: Build a gameKeyLookup first so we can do a reliable
//         second-pass opponent fill after ALL rosters are loaded.
// ======================================================

// Pre-build game key → { homeAbbr, awayAbbr } so we don't depend on
// the order of roster loads when filling opponents
let gameKeyTeams = {}
for (let g of games) {
  let homeFull = g.teams.home.team.name
  let awayFull = g.teams.away.team.name
  let homeAbbr = fullToRotoAbbr[homeFull] || homeFull
  let awayAbbr = fullToRotoAbbr[awayFull] || awayFull
  let key = [homeAbbr, awayAbbr].sort().join(" vs ")
  gameKeyTeams[key] = { homeAbbr, awayAbbr }
}

let playerTeamMap = {}
let nameToMlbId = {}

let todayTeamAbbrs = new Set()
for (let g of games) {
  let homeA = fullToRotoAbbr[g.teams.home.team.name]
  let awayA = fullToRotoAbbr[g.teams.away.team.name]
  if (homeA) todayTeamAbbrs.add(homeA)
  if (awayA) todayTeamAbbrs.add(awayA)
}

for (let abbr of todayTeamAbbrs) {
  let teamId = rotoAbbrToMlbId[abbr]
  if (!teamId) continue
  let rosterData
  try {
    rosterData = await new Request(
      `https://statsapi.mlb.com/api/v1/teams/${teamId}/roster` +
      `?rosterType=active&season=${TODAY_YEAR}`
    ).loadJSON()
  } catch(e) { continue }
  for (let entry of (rosterData?.roster || [])) {
    let p = entry.person
    if (p?.id && p?.fullName) {
      let name = p.fullName.trim()
      nameToMlbId[name.toLowerCase()] = p.id
      if (!playerTeamMap[name]) {
        playerTeamMap[name] = { team: abbr, opponent: null }
      }
    }
  }
}

// FIX 3 — SECOND-PASS opponent fill after all rosters are loaded
// Now iterates every player against every game key to resolve opponent
for (let [name, data] of Object.entries(playerTeamMap)) {
  if (data.opponent) continue  // already resolved
  for (let gKey in gameKeyTeams) {
    let { homeAbbr, awayAbbr } = gameKeyTeams[gKey]
    if (data.team === homeAbbr) {
      data.opponent = awayAbbr
      break
    } else if (data.team === awayAbbr) {
      data.opponent = homeAbbr
      break
    }
  }
}

console.log(`Loaded roster map for ${Object.keys(playerTeamMap).length} players`)
let noOpponent = Object.values(playerTeamMap).filter(d => !d.opponent).length
if (noOpponent > 0) console.log(`WARNING: ${noOpponent} players have no opponent resolved`)

// ======================================================
// STEP 2c — STATCAST METRICS (Hybrid: API for EV/LA, CSV for Barrel%)
// ======================================================

let allPlayerIds = Object.values(nameToMlbId).filter(Boolean)
allPlayerIds = [...new Set(allPlayerIds)]
console.log(`Fetching metrics for ${allPlayerIds.length} players...`)

let launchSpeedMap = {}
const CHUNK_SIZE = 100
for (let offset = 0; offset < allPlayerIds.length; offset += CHUNK_SIZE) {
  let chunk = allPlayerIds.slice(offset, offset + CHUNK_SIZE)
  if (chunk.length === 0) continue
  let data
  try {
    data = await new Request(
      `https://statsapi.mlb.com/api/v1/people` +
      `?personIds=${chunk.join(",")}` +
      `&hydrate=stats(type=metricAverages,metrics=launchSpeed,season=${TODAY_YEAR})`
    ).loadJSON()
  } catch(e) { continue }
  for (let person of (data?.people || [])) {
    let pid = person.id
    let statBlock = (person.stats || []).find(s =>
      s.type?.displayName === "metricAverages" ||
      s.type?.displayName === "metricLog"
    )
    if (!statBlock?.splits?.length) continue
    let val = parseFloat(
      statBlock.splits[0].stat?.metric?.averageValue ??
      statBlock.splits[0].stat?.average ??
      statBlock.splits[0].stat?.value
    )
    if (!isNaN(val)) launchSpeedMap[pid] = val
  }
}
console.log(`launchSpeed: ${Object.keys(launchSpeedMap).length} results`)

let launchAngleMap = {}
for (let offset = 0; offset < allPlayerIds.length; offset += CHUNK_SIZE) {
  let chunk = allPlayerIds.slice(offset, offset + CHUNK_SIZE)
  if (chunk.length === 0) continue
  let data
  try {
    data = await new Request(
      `https://statsapi.mlb.com/api/v1/people` +
      `?personIds=${chunk.join(",")}` +
      `&hydrate=stats(type=metricAverages,metrics=launchAngle,season=${TODAY_YEAR})`
    ).loadJSON()
  } catch(e) { continue }
  for (let person of (data?.people || [])) {
    let pid = person.id
    let statBlock = (person.stats || []).find(s =>
      s.type?.displayName === "metricAverages" ||
      s.type?.displayName === "metricLog"
    )
    if (!statBlock?.splits?.length) continue
    let val = parseFloat(
      statBlock.splits[0].stat?.metric?.averageValue ??
      statBlock.splits[0].stat?.average ??
      statBlock.splits[0].stat?.value
    )
    if (!isNaN(val)) launchAngleMap[pid] = val
  }
}
console.log(`launchAngle: ${Object.keys(launchAngleMap).length} results`)

// FIX 7 — barrel CSV: store keys as both string and int to prevent type mismatch
let barrelMap = {}
const safariHeaders = {
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like MacOS X) " +
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://baseballsavant.mlb.com/"
}

const savantURL =
  `https://baseballsavant.mlb.com/leaderboard/custom` +
  `?year=${TODAY_YEAR}&type=batter&min=1&selections=barrel_batted_rate&csv=true`

function parseCSVLine(line) {
  const fields = []
  let current = '', inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') inQuotes = !inQuotes
    else if (ch === ',' && !inQuotes) {
      let cleaned = current.trim()
      if (cleaned.startsWith('"') && cleaned.endsWith('"')) cleaned = cleaned.slice(1, -1)
      fields.push(cleaned)
      current = ''
    } else current += ch
  }
  let cleaned = current.trim()
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) cleaned = cleaned.slice(1, -1)
  fields.push(cleaned)
  return fields
}

try {
  const req = new Request(savantURL)
  req.headers = safariHeaders
  const csvString = await req.loadString()
  const csvLines = csvString.trim().split(/\r?\n/)
  if (csvLines.length > 1) {
    const headers = parseCSVLine(csvLines[0]).map(h => h.trim().toLowerCase())
    let playerIdIdx = headers.findIndex(h => h.includes("player_id"))
    let barrelIdx = headers.findIndex(h => h.includes("barrel"))
    if (playerIdIdx !== -1 && barrelIdx !== -1) {
      for (let i = 1; i < csvLines.length; i++) {
        const cols = parseCSVLine(csvLines[i])
        const pidStr = cols[playerIdIdx]
        const pidInt = parseInt(pidStr, 10)
        const barrel = parseFloat(cols[barrelIdx])
        if (!isNaN(pidInt) && !isNaN(barrel)) {
          barrelMap[pidInt] = barrel     // integer key (primary)
          barrelMap[pidStr] = barrel     // string key (fallback — FIX 7)
        }
      }
    }
  }
} catch(e) {}
console.log(`barrel_batted_rate (CSV): ${Object.keys(barrelMap).length / 2} players`)

let statcastMap = {}
for (let pid of allPlayerIds) {
  // FIX 7: try both int and string key for barrel
  let barrel = barrelMap.hasOwnProperty(pid) ? barrelMap[pid]
             : barrelMap.hasOwnProperty(String(pid)) ? barrelMap[String(pid)]
             : null
  statcastMap[pid] = {
    ev:     launchSpeedMap.hasOwnProperty(pid) ? launchSpeedMap[pid] : null,
    la:     launchAngleMap.hasOwnProperty(pid) ? launchAngleMap[pid] : null,
    barrel: barrel
  }
}

// ======================================================
// STEP 3 — DRAFTKINGS DIRECT API (HR Props)
// FIX 4: if teamInfo.opponent is null, attempt inline resolution
// FIX 5: use expanded dkTeamAliases for team name matching
// ======================================================

let gameData = {}
let rotoGameKeyToFullHome = {}

// Build a fast abbr→opponent lookup from gameKeyTeams
function resolveOpponent(teamAbbr) {
  for (let gKey in gameKeyTeams) {
    let { homeAbbr, awayAbbr } = gameKeyTeams[gKey]
    if (teamAbbr === homeAbbr) return awayAbbr
    if (teamAbbr === awayAbbr) return homeAbbr
  }
  return null
}

try {
  let dkRaw = await fetchDKHRData()
  let dkEvents     = dkRaw.events     || []
  let dkMarkets    = dkRaw.markets    || []
  let dkSelections = dkRaw.selections || []

  let dkEventMap = {}
  for (let ev of dkEvents) {
    let home = ev.homeTeamName || ""
    let away = ev.awayTeamName || ""

    // FIX v31: live events often have undefined homeTeamName/awayTeamName
    // but DO have ev.name in the format "Away Team vs Home Team" or "Home Team vs Away Team"
    // Try to parse from name if team fields are missing
    if ((!home || home === "undefined") && ev.name) {
      let parts = ev.name.split(" vs ")
      if (parts.length === 2) {
        // DK live format is typically "Away @ Home" or "Away vs Home"
        away = parts[0].trim()
        home = parts[1].trim()
      }
    }
    // Also try ev.teamName1 / ev.teamName2 as fallback fields
    if (!home && ev.teamName2) home = ev.teamName2
    if (!away && ev.teamName1) away = ev.teamName1

    dkEventMap[ev.id] = { homeTeam: home, awayTeam: away, rawName: ev.name || "" }
  }

  let dkMarketMap = {}
  for (let m of dkMarkets) { dkMarketMap[m.id] = m }

  // FIX 5 — expanded DK team name → abbr resolver
  function dkTeamToAbbr(dkName) {
    if (!dkName) return null
    if (fullToRotoAbbr[dkName]) return fullToRotoAbbr[dkName]
    if (rotoAbbrToFull[dkName]) return dkName
    let lower = dkName.toLowerCase().trim()
    // Direct alias lookup
    if (dkTeamAliases[lower] !== undefined) return dkTeamAliases[lower]
    // Partial match: scan rotoAbbrToFull for any full name that starts with or
    // ends with the DK token (handles "NY Yankees" type variants)
    for (let abbr in rotoAbbrToFull) {
      let full = rotoAbbrToFull[abbr].toLowerCase()
      if (full === lower) return abbr
      let parts = full.split(" ")
      let nickname = parts[parts.length - 1]
      if (nickname.length > 3 && lower.includes(nickname)) return abbr
    }
    return null
  }

  // FIX v30: Accept all HR line types.
  // Pre-game:  "1+" = anytime HR
  // Live/in-game: "2+" = 2+ HRs (DK switches market type once game starts)
  // We also accept "3+" for completeness.
  // Each label is stored separately per player so output can show
  // "1+ +350 DK" vs "2+ +180 DK" clearly.
  const VALID_LABELS = new Set(["1+", "2+", "3+"])

  // seen is now keyed on "playerName|label" to allow one entry per label
  let seen = {}

  for (let sel of dkSelections) {
    let lbl = String(sel.label || "").trim()
    if (!VALID_LABELS.has(lbl)) continue

    let playerName = null
    if (sel.participants && sel.participants.length > 0) {
      let names = sel.participants
        .filter(p => p.type === "Player" || !p.type)
        .map(p => p.name || p.displayName || ("P" + p.id))
      if (names.length > 0) playerName = names.join(", ")
    }
    if (!playerName) continue

    let seenKey = playerName + "|" + lbl
    if (seen[seenKey]) continue
    seen[seenKey] = true

    let oddsRaw = null
    if (sel.displayOdds && sel.displayOdds.american !== undefined) {
      oddsRaw = sel.displayOdds.american
    } else if (sel.americanOdds !== undefined && sel.americanOdds !== null) {
      oddsRaw = sel.americanOdds
    }
    if (oddsRaw === null) continue
    let oddsNum = parseInt(String(oddsRaw).replace("+", ""), 10)
    if (isNaN(oddsNum)) continue

    let matchedName = Object.keys(playerTeamMap).find(
      rosterName => nameMatches(playerName, rosterName)
    )
    if (!matchedName) continue
    let teamInfo = playerTeamMap[matchedName]

    if (!teamInfo.opponent) {
      teamInfo.opponent = resolveOpponent(teamInfo.team)
    }
    if (!teamInfo.opponent) continue

    let gKey = [teamInfo.team, teamInfo.opponent].sort().join(" vs ")

    let market = dkMarketMap[sel.marketId]
    let eventId = market ? (market.eventId || market.event_id) : null
    if (eventId && dkEventMap[eventId] && !rotoGameKeyToFullHome[gKey]) {
      let ev = dkEventMap[eventId]
      let homeAbbr = dkTeamToAbbr(ev.homeTeam)
      let awayAbbr = dkTeamToAbbr(ev.awayTeam)
      if (homeAbbr && awayAbbr) {
        let dkKey = [homeAbbr, awayAbbr].sort().join(" vs ")
        let mlbFullHome = rotoAbbrToFull[homeAbbr] || ev.homeTeam
        rotoGameKeyToFullHome[dkKey] = mlbFullHome
      }
    }

    if (!gameData[gKey]) gameData[gKey] = {}
    if (!gameData[gKey][matchedName]) {
      gameData[gKey][matchedName] = { team: teamInfo.team, books: [] }
    }
    // Store each label as a separate book entry: "DraftKings 1+", "DraftKings 2+", etc.
    let bookLabel = `DraftKings ${lbl}`
    let existing = gameData[gKey][matchedName].books.find(b => b.book === bookLabel)
    if (existing) {
      if (oddsNum > existing.odds) existing.odds = oddsNum
    } else {
      gameData[gKey][matchedName].books.push({ book: bookLabel, odds: oddsNum })
    }
  }

  console.log(`DK HR props loaded: ${Object.keys(gameData).length} games, ` +
    `${Object.values(gameData).reduce((n,g) => n + Object.keys(g).length, 0)} players`)

  // DEBUG v31: dump raw DK event names + all subcategory IDs seen in markets
  output += "\n============================\n"
  output += "DK RAW DEBUG v31\n"
  output += "============================\n"

  output += `\nDK Events (${dkEvents.length} total):\n`
  for (let ev of dkEvents) {
    output += `  id=${ev.id} | "${ev.awayTeamName}" @ "${ev.homeTeamName}" | state=${ev.eventStatus || ev.state || "?"}\n`
  }

  // Collect all distinct subcategoryIds from markets
  let subCatsSeen = {}
  for (let m of dkMarkets) {
    let sid = m.clientMetadata?.subCategoryId || m.subCategoryId || "?"
    let sname = m.clientMetadata?.subCategoryName || m.subCategoryName || "?"
    let key2 = `${sid}:${sname}`
    subCatsSeen[key2] = (subCatsSeen[key2] || 0) + 1
  }
  output += `\nMarket subcategory IDs seen:\n`
  for (let [k, cnt] of Object.entries(subCatsSeen)) {
    output += `  ${k}  (${cnt} markets)\n`
  }

  // Show which roster teams had no opponent resolved
  output += `\nSchedule game keys (from MLB API):\n`
  for (let gk in gameKeyTeams) {
    let { homeAbbr, awayAbbr } = gameKeyTeams[gk]
    let hasData = Object.keys(gameData[gk] || {}).length
    output += `  ${gk}  home=${homeAbbr} away=${awayAbbr}  players=${hasData}\n`
  }

  output += `\ngameData keys populated by DK:\n`
  for (let gk of Object.keys(gameData)) {
    let cnt = Object.keys(gameData[gk]).length
    if (cnt > 0) output += `  ${gk}  (${cnt} players)\n`
  }
} catch(e) {
  console.log("DK fetch error: " + e)
  output += `⚠️  DK odds fetch failed: ${e}\n\n`
}

// ======================================================
// STEP 5 — OUTPUT
// ======================================================

output += "============================\n"
output += "LIVE & UPCOMING GAMES (HR Props)\n"
output += "============================\n"

let sortedKeys = Object.keys(rotoGameKeyToFullHome).sort()

for (let g of games) {
  let homeFull = g.teams.home.team.name
  let awayFull = g.teams.away.team.name
  let homeAbbr = fullToRotoAbbr[homeFull] || homeFull
  let awayAbbr = fullToRotoAbbr[awayFull] || awayFull
  let key = [homeAbbr, awayAbbr].sort().join(" vs ")
  rotoGameKeyToFullHome[key] = homeFull
  if (!gameData[key]) gameData[key] = {}
  if (!sortedKeys.includes(key)) sortedKeys.push(key)
}
sortedKeys.sort()

let gameKeyToMeta = {}
for (let g of games) {
  let homeFull = g.teams.home.team.name
  let awayFull = g.teams.away.team.name
  let homeAbbr = fullToRotoAbbr[homeFull] || homeFull
  let awayAbbr = fullToRotoAbbr[awayFull] || awayFull
  let key = [homeAbbr, awayAbbr].sort().join(" vs ")
  gameKeyToMeta[key] = {
    gamePk:        g.gamePk,
    state:         g.status.abstractGameState,   // "Preview" | "Live" | "Final"
    detailedState: g.status.detailedState || "",  // "In Progress", "Final", etc.
    awayTeam:      awayFull,
    homeTeam:      homeFull,
  }
}

for (let gKey of sortedKeys) {
  let fullHome  = rotoGameKeyToFullHome[gKey] || null
  let wx        = fullHome ? (gameWeather[fullHome] || null) : null
  let homeAbbr  = fullHome ? (fullToRotoAbbr[fullHome] || null) : null
  let pp        = pitcherIdMap[gKey] || {}

  let gameMeta = gameKeyToMeta[gKey]
  let liveInfo = null
  // Only fetch live feed for games actually in progress (Live state)
  // Final games are excluded from the game list entirely now (v29)
  if (gameMeta && gameMeta.state === "Live") {
    liveInfo = await fetchLiveGameData(gameMeta.gamePk)
  }

  let gTeams = gKey.split(" vs ")
  let teamA = gTeams[0]
  let teamB = gTeams[1]

  let byTeam = { [teamA]: [], [teamB]: [] }

  for (let [name, info] of Object.entries(playerTeamMap)) {
    if (info.team !== teamA && info.team !== teamB) continue
    let oddsEntry = (gameData[gKey] || {})[name]
    if (oddsEntry && oddsEntry.books.length > 0) {
      byTeam[info.team].push({ name, info, oddsEntry })
    }
  }

  // FIX v28: Never skip a game entirely.
  // If no DK lines exist yet (pre-game, lines not posted, or game over),
  // still show the game header + probable starters so the slate is complete.
  let hasAny = byTeam[teamA].length > 0 || byTeam[teamB].length > 0

  output += "\n"
  if (liveInfo) {
    let stateTag = liveInfo.isFinal ? "[FINAL]" : "[LIVE]"
    output += `GAME: ${gKey}  ${stateTag}  Score: ${liveInfo.score}  •  ${liveInfo.inning}\n`
    if (liveInfo.isFinal) {
      output += `Final Pitchers: Away — ${liveInfo.awayPitcher} (HR/9: ${liveInfo.awayHr9})  |  Home — ${liveInfo.homePitcher} (HR/9: ${liveInfo.homeHr9})\n`
    } else {
      output += `Current Pitcher: Away — ${liveInfo.awayPitcher} (HR/9: ${liveInfo.awayHr9})  |  Home — ${liveInfo.homePitcher} (HR/9: ${liveInfo.homeHr9})\n`
    }
  } else {
    let detailedState = gameKeyToMeta[gKey]?.detailedState || ""
    if (detailedState && detailedState !== "Scheduled" && detailedState !== "Pre-Game") {
      output += `GAME: ${gKey}  [${detailedState.toUpperCase()}]\n`
    } else {
      output += `GAME: ${gKey}\n`
    }
  }
  output += `${"─".repeat(44)}\n`

  if (!liveInfo) {
    let ppParts = []
    for (let side of ["away","home"]) {
      let p = pp[side]
      if (!p) continue
      let statsEntry = p.id ? pitcherStatsMap[p.id] : null
      let hr9 = statsEntry ? statsEntry.hr9 : "—"
      let label = side === "away" ? "Away SP" : "Home SP"
      ppParts.push(`${label}: ${p.name} (HR/9: ${hr9})`)
    }
    if (ppParts.length) output += ppParts.join("  |  ") + "\n"
  }

  // If no DK lines found for this game, show a notice and move on
  if (!hasAny) {
    output += `  ⚠️  No DK HR lines found for this game (lines not yet posted or off the board)\n`
    output += "\n"
    continue
  }

  for (let team of Object.keys(byTeam).sort()) {
    byTeam[team].sort((a,b) => {
      let maxA = Math.max(...a.oddsEntry.books.map(b => b.odds))
      let maxB = Math.max(...b.oddsEntry.books.map(b => b.odds))
      return maxB - maxA
    })

    if (byTeam[team].length > 0) {
      output += `\n  ── ${team} ──\n`
      output += `  (${byTeam[team].length} with DK line)\n`

      for (let { name, info, oddsEntry } of byTeam[team]) {
        let pid = nameToMlbId[name.toLowerCase()]
        let sc  = pid ? statcastMap[pid] : null
        let barrelStr = sc?.barrel != null ? sc.barrel.toFixed(1) + "%" : "—"
        let evStr     = sc?.ev     != null ? sc.ev.toFixed(1)     + " mph" : "—"
        let laStr     = sc?.la     != null ? sc.la.toFixed(1)     + "°" : "—"

        oddsEntry.books.sort((a,b) => b.odds - a.odds)
        let oddsStr = oddsEntry.books.map(b => {
          let sign = b.odds >= 0 ? "+" : ""
          return `${sign}${b.odds} ${bookShort(b.book)}`
        }).join(" / ")

        let pitcherStr = "—"
        if (liveInfo) {
          // Batter faces the OPPOSING team's pitcher
          // If batter is on home team → faces away pitcher; if away → faces home pitcher
          let batterIsHome = (info.team === homeAbbr)
          let facingName = batterIsHome ? liveInfo.awayPitcher : liveInfo.homePitcher
          let facingHr9  = batterIsHome ? liveInfo.awayHr9     : liveInfo.homeHr9
          pitcherStr = `${facingName} (HR/9: ${facingHr9})${liveInfo.isFinal ? " [FINAL]" : " ⚡LIVE"}`
        } else {
          let faceSide = homeAbbr
            ? (info.team === homeAbbr ? "away" : "home")
            : null
          let facePP  = faceSide ? pp[faceSide] : null
          let faceStats = facePP?.id ? pitcherStatsMap[facePP.id] : null
          pitcherStr = facePP
            ? `${facePP.name} — ${faceStats ? faceStats.hr9 : "—"}`
            : "—"
        }

        output += "\n"
        output += `  Player:       ${name}\n`
        output += `  Odds:         ${oddsStr}\n`
        output += `  Barrel%:      ${barrelStr}  |  EV: ${evStr}  |  LA: ${laStr}\n`
        output += `  Pitcher:      ${pitcherStr}\n`
        output += `  Weather:      ${weatherShort(wx)}\n`
      }
    }
  }
  output += "\n"
}

// ======================================================
// TOP 10 COMPOSITE SCORE LEADERBOARD
// Runs over all Live/Preview players with active DK lines.
// Score (max ~105):
//   Power    40pts → Barrel% (20) + EV normalized (10) + LA sweetspot (10)
//   Pitcher  30pts → opposing pitcher's HR/9 rate (higher = better for batter)
//   Context  35pts → park factor (15) + temp (10) + wind direction (10)
// ======================================================

const parkFactors = {
  "COL":130,"CIN":115,"TEX":112,"HOU":108,"BAL":107,"TOR":107,
  "WSH":105,"LAA":105,"MIN":102,"BOS":100,"ATL":100,"PHI":100,
  "MIL":100,"MIA":96,"NYM":96,"LAD":96,"ATH":97,"SD":97,"TB":97,
  "KC":97,"CWS":93,"DET":92,"SF":93,"SEA":95,"STL":95,"PIT":94,
  "CHC":94,"NYY":100,"ARI":100,"CLE":100,
}

function getOppPitcherHr9(batterTeam, gKey, homeAbbrLocal) {
  let ppLocal = pitcherIdMap[gKey] || {}
  let faceSide = homeAbbrLocal
    ? (batterTeam === homeAbbrLocal ? "away" : "home")
    : null
  if (!faceSide) return 1.0
  let facePP = ppLocal[faceSide]
  if (!facePP?.id) return 1.0
  let stats = pitcherStatsMap[facePP.id]
  let hr9 = stats?.hr9
  if (!hr9 || hr9 === "—") return 1.0
  return parseFloat(hr9) || 1.0
}

let evLeaderboard = []

for (let gKey of sortedKeys) {
  let fullHome   = rotoGameKeyToFullHome[gKey] || null
  let homeAbbr2  = fullHome ? (fullToRotoAbbr[fullHome] || null) : null
  let wx2        = fullHome ? (gameWeather[fullHome] || null) : null
  let gameMeta   = gameKeyToMeta[gKey]
  if (!gameMeta) continue
  // Only include Live and Preview games (Finals excluded)
  if (gameMeta.state !== "Live" && gameMeta.state !== "Preview") continue

  let gd = gameData[gKey] || {}
  for (let [name, entry] of Object.entries(gd)) {
    if (!entry.books.length) continue
    let info = playerTeamMap[name]
    if (!info) continue
    let pid = nameToMlbId[name.toLowerCase()]
    let sc = pid ? statcastMap[pid] : null
    if (!sc) continue
    let ev = sc.ev, barrel = sc.barrel, la = sc.la
    if (ev == null) continue   // EV required to rank

    let maxOdds = Math.max(...entry.books.map(b => b.odds))

    // ── Power score (40pts max) ──
    let barrelScore = barrel != null ? Math.min(barrel / 25 * 20, 20) : 8
    let evScore     = Math.min(Math.max((ev - 80) / 20 * 10, 0), 10)
    let laBonus     = (la != null && la >= 10 && la <= 30) ? 10 : (la != null ? 4 : 5)
    let powerScore  = barrelScore + evScore + laBonus

    // ── Pitcher score (30pts max) ──
    let pHr9 = getOppPitcherHr9(info.team, gKey, homeAbbr2)
    let pitcherScore = Math.min(pHr9 / 2.0 * 30, 30)

    // ── Context score (35pts max) ──
    let pf = parkFactors[info.team] || 100
    let parkScore = Math.min(Math.max((pf - 90) / 40 * 15, 0), 15)
    let temp = wx2?.temp || 72
    let tempScore = Math.min(Math.max((temp - 60) / 40 * 10, 0), 10)
    let windScore = 5
    if (wx2) {
      let wd = wx2.windDir || ""
      if (wd === "W" || wd === "SW") windScore = 10
      else if (wd === "N" || wd === "NE") windScore = 2
      else windScore = 5
    }
    let contextScore = parkScore + tempScore + windScore

    let totalScore = Math.round(powerScore + pitcherScore + contextScore)

    evLeaderboard.push({
      name, team: info.team, gKey, odds: maxOdds,
      ev: ev.toFixed(1),
      barrel: barrel != null ? barrel.toFixed(1) : "—",
      la: la != null ? la.toFixed(1) : "—",
      pitcherHr9: pHr9.toFixed(2),
      score: totalScore,
      state: gameMeta.state,
    })
  }
}

evLeaderboard.sort((a, b) => b.score - a.score)
let top10EV = evLeaderboard.slice(0, 10)

output += "============================================================\n"
output += "  🔥 TOP 10 HR TARGETS — LIVE + UPCOMING (Composite Score)\n"
output += "  Power 40% | Pitcher Matchup 30% | Park/Weather 30%\n"
output += "  Updates each run. Only Live/Preview games included.\n"
output += "============================================================\n\n"

if (top10EV.length === 0) {
  output += "  No active lines found — all games may be off the board.\n\n"
} else {
  let rank = 1
  for (let p of top10EV) {
    let tag    = p.state === "Live" ? "⚡LIVE" : "📋PRE-GAME"
    let odds   = p.odds >= 0 ? `+${p.odds}` : `${p.odds}`
    output += `  #${String(rank).padStart(2)}  ${p.name}  (${p.team})  ${tag}\n`
    output += `        Score: ${p.score}/105  |  DK: ${odds}\n`
    output += `        EV: ${p.ev} mph  |  Barrel: ${p.barrel}%  |  LA: ${p.la}°\n`
    output += `        Opp Pitcher HR/9: ${p.pitcherHr9}\n\n`
    rank++
  }
}

QuickLook.present(output)
