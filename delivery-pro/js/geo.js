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

// ---- Geometria do caminho (plano local em metros, suficiente para distâncias de cidade) ----
function emMetros(ref) {
  const kx = 111320 * Math.cos((ref.lat * Math.PI) / 180), ky = 110540;
  return { x: (p) => (p.lng - ref.lng) * kx, y: (p) => (p.lat - ref.lat) * ky };
}

// Ponto do caminho mais perto de "pos": { i (trecho), t (0..1 dentro do trecho), ponto, distancia (m) }
export function projetarNoCaminho(pontos, pos) {
  const m = emMetros(pos);
  let melhor = { i: 0, t: 0, ponto: pontos[0], distancia: Infinity };
  for (let i = 0; i < pontos.length - 1; i++) {
    const ax = m.x(pontos[i]), ay = m.y(pontos[i]), bx = m.x(pontos[i + 1]), by = m.y(pontos[i + 1]);
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    const px = ax + t * dx, py = ay + t * dy, d = Math.sqrt(px * px + py * py);
    if (d < melhor.distancia) {
      melhor = { i, t, distancia: d, ponto: { lat: pontos[i].lat + (pontos[i + 1].lat - pontos[i].lat) * t, lng: pontos[i].lng + (pontos[i + 1].lng - pontos[i].lng) * t } };
    }
  }
  return melhor;
}

// Pedaço do caminho entre duas projeções (seguindo as curvas da rua)
export function trechoDoCaminho(pontos, de, ate) {
  const depois = ate.i > de.i || (ate.i === de.i && ate.t >= de.t);
  if (!depois) return [de.ponto, ate.ponto];
  return [de.ponto, ...pontos.slice(de.i + 1, ate.i + 1), ate.ponto];
}

// Pedaço do caminho entre duas distâncias (em metros) desde o início — usado no simulador
export function trechoPorDistancia(pontos, d0, d1) {
  const pontoEm = (alvo) => {
    let resto = alvo;
    for (let i = 0; i < pontos.length - 1; i++) {
      const seg = calcularDistanciaMetros(pontos[i].lat, pontos[i].lng, pontos[i + 1].lat, pontos[i + 1].lng);
      if (resto <= seg || i === pontos.length - 2) {
        const t = seg ? Math.min(1, resto / seg) : 0;
        return { i, t, ponto: { lat: pontos[i].lat + (pontos[i + 1].lat - pontos[i].lat) * t, lng: pontos[i].lng + (pontos[i + 1].lng - pontos[i].lng) * t } };
      }
      resto -= seg;
    }
    return { i: 0, t: 0, ponto: pontos[0] };
  };
  return trechoDoCaminho(pontos, pontoEm(d0), pontoEm(d1));
}

export function comprimentoCaminho(pontos) {
  let total = 0;
  for (let i = 1; i < pontos.length; i++) total += calcularDistanciaMetros(pontos[i - 1].lat, pontos[i - 1].lng, pontos[i].lat, pontos[i].lng);
  return total;
}

// Cria o marcador da moto. Ela anda SEMPRE por um caminho (lista de pontos), em velocidade
// constante, seguindo as curvas. O desenho 🛵 olha para a esquerda: em vez de girar (ficaria de
// cabeça para baixo), ele é espelhado — e só troca de lado quando a moto vai claramente para
// leste ou oeste (indo para norte/sul ele mantém o lado, para não ficar "dançando").
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
  let ladoDireito = false;

  function virarPara(a, b) {
    if (calcularDistanciaMetros(a.lat, a.lng, b.lat, b.lng) < 4) return;
    const ang = calcularAnguloDirecao(a.lat, a.lng, b.lat, b.lng);
    let novo = ladoDireito;
    if (ang > 25 && ang < 155) novo = true;        // leste
    else if (ang > 205 && ang < 335) novo = false; // oeste
    if (novo !== ladoDireito) {
      ladoDireito = novo;
      const emoji = marker.getElement() && marker.getElement().querySelector('.moto-emoji');
      if (emoji) emoji.style.transform = ladoDireito ? 'scaleX(-1)' : 'scaleX(1)';
    }
  }

  function moverPeloCaminho(caminho, duracaoMs = 2000) {
    if (animFrame) cancelAnimationFrame(animFrame);
    const pts = [posAtual, ...caminho.filter(Boolean)];
    const segs = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = calcularDistanciaMetros(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng);
      segs.push(d); total += d;
    }
    const destino = pts[pts.length - 1];
    if (total < 0.5) { posAtual = { ...destino }; marker.setLatLng([destino.lat, destino.lng]); return; }
    const inicio = performance.now();
    function step(agora) {
      const andado = Math.min((agora - inicio) / duracaoMs, 1) * total;
      let resto = andado, i = 0;
      while (i < segs.length - 1 && resto > segs[i]) { resto -= segs[i]; i++; }
      const t = segs[i] ? Math.min(1, resto / segs[i]) : 1;
      const a = pts[i], b = pts[i + 1];
      virarPara(a, b);
      // posAtual acompanha a tela a cada quadro: se chegar posição nova no meio, continua daqui (sem voltar)
      posAtual = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
      marker.setLatLng([posAtual.lat, posAtual.lng]);
      if (andado < total) animFrame = requestAnimationFrame(step);
      else posAtual = { ...destino };
    }
    animFrame = requestAnimationFrame(step);
  }

  const moverSuavemente = (novasCoords, duracaoMs = 2000) => moverPeloCaminho([novasCoords], duracaoMs);
  return { marker, moverSuavemente, moverPeloCaminho, posicao: () => ({ ...posAtual }) };
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

// Caminho pelas ruas passando por várias paradas, na ordem. Devolve { pontos, metros, segundos, trechos:[{metros,segundos}] } ou null.
export async function buscarRotaVarias(paradas) {
  const ok = paradas.filter(p => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)));
  if (ok.length < 2) return null;
  try {
    const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${ok.map(p => `${p.lng},${p.lat}`).join(';')}?overview=full&geometries=geojson`);
    if (!r.ok) return null;
    const d = await r.json();
    const rota = d.routes && d.routes[0];
    if (!rota) return null;
    return {
      pontos: rota.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
      metros: rota.distance, segundos: rota.duration,
      trechos: (rota.legs || []).map(l => ({ metros: l.distance, segundos: l.duration }))
    };
  } catch (_) { return null; }
}

// Linha azul do caminho que FALTA até o cliente. Busca a rota de novo a cada ~1 min (ou se a
// moto sair do caminho). A moto é "encaixada" na linha: a posição do GPS (que oscila uns metros)
// vira o ponto mais perto da rua, e a moto anda pelas curvas até lá.
export function criarLinhaRota(map) {
  const contorno = L.polyline([], { color: '#ffffff', weight: 9, opacity: 0.9, interactive: false }).addTo(map);
  const linha = L.polyline([], { color: '#2563eb', weight: 5, opacity: 0.95, interactive: false }).addTo(map);
  let pontos = null;
  let buscadaEm = 0;
  let destinoUsado = null;
  let versao = 0;
  let ultimaProj = null;

  async function garantirRota(pos, destino) {
    const proj = pontos ? projetarNoCaminho(pontos, pos) : null;
    const destinoMudou = !destinoUsado || destinoUsado.lat !== destino.lat || destinoUsado.lng !== destino.lng;
    if (!pontos || destinoMudou || proj.distancia > 80 || Date.now() - buscadaEm > 90000) {
      buscadaEm = Date.now();
      destinoUsado = destino;
      pontos = (await buscarRota(pos, destino)) || [pos, destino];
      versao++;
      ultimaProj = null;
    }
  }

  function desenhar(proj) {
    const resto = [[proj.ponto.lat, proj.ponto.lng], ...pontos.slice(proj.i + 1).map(p => [p.lat, p.lng])];
    contorno.setLatLngs(resto);
    linha.setLatLngs(resto);
  }

  // Atualiza a linha com a posição nova e move a moto POR CIMA dela
  async function acompanhar(pos, destino, moto, duracaoMs = 2000) {
    if (!pos || !destino) return;
    const versaoAntes = versao;
    await garantirRota(pos, destino);
    const proj = projetarNoCaminho(pontos, pos);
    if (moto) {
      if (ultimaProj && versao === versaoAntes) moto.moverPeloCaminho(trechoDoCaminho(pontos, ultimaProj, proj).slice(1), duracaoMs);
      else moto.moverPeloCaminho([proj.ponto], duracaoMs);
    }
    ultimaProj = proj;
    desenhar(proj);
  }

  // Compatível com o uso antigo (só desenha a linha)
  const atualizar = (pos, destino) => acompanhar(pos, destino, null);

  // Para o simulador: usa um caminho já conhecido
  function definir(caminho) { pontos = caminho; buscadaEm = Date.now(); destinoUsado = caminho[caminho.length - 1]; versao++; ultimaProj = null; }
  function remover() { contorno.remove(); linha.remove(); }

  return { atualizar, acompanhar, definir, remover, caminho: () => pontos };
}
