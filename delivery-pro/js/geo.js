// Cálculo exato de distância em metros entre duas coordenadas (Fórmula de Haversine)
export function calcularDistanciaMetros(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Raio da Terra em metros
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

// Calcula o ângulo de direção (Bearing) para girar o ícone da moto na direção da rua
export function calcularAnguloDirecao(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const toDeg = (rad) => (rad * 180) / Math.PI;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Valida se o entregador está dentro do raio permitido (100m + margem de precisão do GPS)
export function validarCercaEntrega(motoCoords, destinoCoords, raioBaseMetros = 100) {
  const distancia = calcularDistanciaMetros(
    motoCoords.lat,
    motoCoords.lng,
    destinoCoords.lat,
    destinoCoords.lng
  );
  const margemPrecisao = Math.min(Number(motoCoords.accuracy) || 0, 40); // Limita tolerância extra a 40m
  const limiteEfetivo = raioBaseMetros + margemPrecisao;

  return {
    permitido: distancia <= limiteEfetivo,
    distanciaMetros: distancia,
    limiteEfetivo
  };
}

// Inicializa o mapa Leaflet com OpenStreetMap padrão oficial
export function criarMapaRastreamento(elementId, centroCoords, zoom = 15) {
  const map = L.map(elementId).setView([centroCoords.lat, centroCoords.lng], zoom);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(map);

  return map;
}

// Cria o marcador da moto com deslizamento suave (interpolação).
// O desenho 🛵 olha para a esquerda: em vez de girar (ficaria de cabeça para baixo), ele é
// espelhado para olhar para o lado em que está indo — sempre de pé, como num app de entrega.
export function criarMarcadorMoto(map, coordsIniciais) {
  const motoIcon = L.divIcon({
    className: 'moto-marker-wrapper',
    html: '<div class="moto-icone"><span class="moto-emoji">🛵</span></div>',
    iconSize: [40, 40],
    iconAnchor: [20, 20]
  });

  const marker = L.marker([coordsIniciais.lat, coordsIniciais.lng], { icon: motoIcon, zIndexOffset: 1000 }).addTo(map);
  let posAtual = { ...coordsIniciais };
  let animFrame = null;

  function moverSuavemente(novasCoords, duracaoMs = 2000) {
    if (animFrame) cancelAnimationFrame(animFrame);
    const andou = calcularDistanciaMetros(posAtual.lat, posAtual.lng, novasCoords.lat, novasCoords.lng) > 2;
    const emoji = marker.getElement() && marker.getElement().querySelector('.moto-emoji');
    if (emoji && andou) {
      const angulo = calcularAnguloDirecao(posAtual.lat, posAtual.lng, novasCoords.lat, novasCoords.lng);
      emoji.style.transform = angulo < 180 ? 'scaleX(-1)' : 'scaleX(1)'; // indo para leste: vira para a direita
    }

    const inicioLat = posAtual.lat;
    const inicioLng = posAtual.lng;
    const deltaLat = novasCoords.lat - inicioLat;
    const deltaLng = novasCoords.lng - inicioLng;
    const inicioTempo = performance.now();

    function step(agora) {
      const progresso = Math.min((agora - inicioTempo) / duracaoMs, 1);
      marker.setLatLng([inicioLat + deltaLat * progresso, inicioLng + deltaLng * progresso]);
      if (progresso < 1) animFrame = requestAnimationFrame(step);
      else posAtual = { ...novasCoords };
    }
    animFrame = requestAnimationFrame(step);
  }

  return { marker, moverSuavemente };
}

// Caminho pelas ruas (OSRM / OpenStreetMap, gratuito). Devolve [{lat,lng}...] ou null.
export async function buscarRota(a, b) {
  try {
    const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`);
    if (!r.ok) return null;
    const d = await r.json();
    const pts = d.routes && d.routes[0] && d.routes[0].geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
    return pts && pts.length > 1 ? pts : null;
  } catch (_) { return null; }
}

// Índice do trecho (pontos[i] → pontos[i+1]) mais perto da posição (projeção num plano local)
function segmentoMaisPerto(pontos, pos) {
  const kx = 111320 * Math.cos((pos.lat * Math.PI) / 180), ky = 110540;
  let melhor = 0, menor = Infinity;
  for (let i = 0; i < pontos.length - 1; i++) {
    const ax = (pontos[i].lng - pos.lng) * kx, ay = (pontos[i].lat - pos.lat) * ky;
    const bx = (pontos[i + 1].lng - pos.lng) * kx, by = (pontos[i + 1].lat - pos.lat) * ky;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    const px = ax + t * dx, py = ay + t * dy, d = px * px + py * py;
    if (d < menor) { menor = d; melhor = i; }
  }
  return melhor;
}

// Linha azul do caminho que FALTA até o cliente. Busca a rota de novo a cada ~1 min
// (ou se a moto sair do caminho) e vai "comendo" o trecho já percorrido.
export function criarLinhaRota(map) {
  const contorno = L.polyline([], { color: '#ffffff', weight: 9, opacity: 0.9, interactive: false }).addTo(map);
  const linha = L.polyline([], { color: '#2563eb', weight: 5, opacity: 0.95, interactive: false }).addTo(map);
  let pontos = null;
  let buscadaEm = 0;
  let destinoUsado = null;

  async function atualizar(pos, destino) {
    if (!pos || !destino) return;
    const longeDoCaminho = pontos && Math.min(...pontos.map(p => calcularDistanciaMetros(p.lat, p.lng, pos.lat, pos.lng))) > 120;
    const destinoMudou = !destinoUsado || destinoUsado.lat !== destino.lat || destinoUsado.lng !== destino.lng;
    if (!pontos || destinoMudou || longeDoCaminho || Date.now() - buscadaEm > 60000) {
      buscadaEm = Date.now();
      destinoUsado = destino;
      pontos = (await buscarRota(pos, destino)) || [pos, destino];
    }
    // Corta o trecho já percorrido: acha o pedaço de rua em que a moto está e começa dali
    const resto = [[pos.lat, pos.lng], ...pontos.slice(segmentoMaisPerto(pontos, pos) + 1).map(p => [p.lat, p.lng])];
    contorno.setLatLngs(resto);
    linha.setLatLngs(resto);
  }

  // Para o simulador: usa um caminho já conhecido
  function definir(caminho) { pontos = caminho; buscadaEm = Date.now(); destinoUsado = caminho[caminho.length - 1]; }
  function remover() { contorno.remove(); linha.remove(); }

  return { atualizar, definir, remover };
}
