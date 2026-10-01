/**
 * 부산 상가 업종별 지도 (Busan Commercial Store Map by Industry)
 * 부산시 전역 159,689개 상가 위치 & 10대 업종별 / 구·군별 고속 탐색
 * 국토교통부 VWorld 무료 지도 기반
 */

(function () {
  'use strict';

  // 1. 상태 관리 변수
  const state = {
    allStores: [],       // RAW_BUSAN_STORES 참조
    filteredStores: [],  // 필터된 매장 배열
    categoriesMeta: [],  // 10대 대분류 메타
    guMeta: [],          // 16개 구/군 메타
    jungList: [],        // 75개 중분류 메타
    selectedDaeIdx: null,  // null: 전체, 0~9: 대분류 인덱스
    selectedJungIdx: null, // null: 전체, 중분류 인덱스
    selectedGuIdx: null,   // null: 전체, 0~15: 구/군 인덱스
    keyword: '',
    userCoords: null,    // { lat, lng }
    userMarker: null,
    currentTileIndex: 0,
    selectedStoreId: null,
    markersMap: new Map(), // id -> L.marker
    isMapMoving: false
  };

  // 100% 무료 지도 타일 레이어 (국토교통부 VWorld + 글로벌 OSM, Zoom 7~19)
  const TILE_LAYERS = [
    {
      name: 'VWorld 대한민국 표준지도 (국토교통부)',
      url: 'https://xdworld.vworld.kr/2d/Base/service/{z}/{x}/{y}.png',
      attribution: '&copy; <a href="https://www.vworld.kr/" target="_blank">국토교통부 VWorld</a>',
      minZoom: 7,
      maxZoom: 19
    },
    {
      name: 'VWorld 모던 백지도 (마커 집중)',
      url: 'https://xdworld.vworld.kr/2d/white/service/{z}/{x}/{y}.png',
      attribution: '&copy; <a href="https://www.vworld.kr/" target="_blank">국토교통부 VWorld</a>',
      minZoom: 7,
      maxZoom: 19
    },
    {
      name: 'OSM Humanitarian (선명한 오픈 지도)',
      url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors, Tiles by <a href="https://www.hotosm.org/" target="_blank">HOT</a>',
      minZoom: 7,
      maxZoom: 18
    }
  ];

  const BUSAN_CENTER = [35.17955, 129.07564];
  const BUSAN_DEFAULT_ZOOM = 12;

  // DOM 캐시
  const elements = {
    map: null,
    markerClusterGroup: null,
    tileLayer: null,
    searchInput: document.getElementById('searchInput'),
    clearSearchBtn: document.getElementById('clearSearchBtn'),
    guSelect: document.getElementById('guSelect'),
    jungSelect: document.getElementById('jungSelect'),
    geoBtn: document.getElementById('geoBtn'),
    mobileGeoBtn: document.getElementById('mobileGeoBtn'),
    allCategoryBtn: document.getElementById('allCategoryBtn'),
    categoryGrid: document.getElementById('categoryGrid'),
    matchCount: document.getElementById('matchCount'),
    mobileListCount: document.getElementById('mobileListCount'),
    resetFilterBtn: document.getElementById('resetFilterBtn'),
    storeList: document.getElementById('storeList'),
    sidebar: document.getElementById('sidebar'),
    closeSidebarBtn: document.getElementById('closeSidebarBtn'),
    mobileSearchTrigger: document.getElementById('mobileSearchTrigger'),
    mobileSearchText: document.getElementById('mobileSearchText'),
    mobileSheetHandle: document.getElementById('mobileSheetHandle'),
    sheetChevron: document.getElementById('sheetChevron'),
    mapResetViewBtn: document.getElementById('mapResetViewBtn'),
    toggleTileBtn: document.getElementById('toggleTileBtn'),
    toast: document.getElementById('toast')
  };

  // 2. 초기화
  function init() {
    if (typeof RAW_BUSAN_STORES !== 'undefined' && Array.isArray(RAW_BUSAN_STORES)) {
      state.allStores = RAW_BUSAN_STORES;
      state.categoriesMeta = BUSAN_CATEGORIES_META || [];
      state.guMeta = BUSAN_GU_META || [];
      state.jungList = BUSAN_JUNG_LIST || [];
    } else {
      console.error('stores-data.js 파일이 로드되지 않았습니다.');
      showToast('상가 데이터를 불러오는 데 실패했습니다.');
      return;
    }

    renderCategoryGrid();
    initMap();
    setupEventListeners();
    applyFilters(false);
  }

  // 3. 업종 대분류 그리드 생성
  function renderCategoryGrid() {
    const grid = elements.categoryGrid;
    grid.innerHTML = '';

    state.categoriesMeta.forEach(cat => {
      const card = document.createElement('div');
      card.className = 'cat-card';
      card.id = `cat-card-${cat.idx}`;
      card.setAttribute('data-idx', cat.idx);
      card.style.borderLeft = `4px solid ${cat.color}`;

      card.innerHTML = `
        <div class="cat-left">
          <span class="cat-icon">${cat.icon}</span>
          <span class="cat-name">${cat.name}</span>
        </div>
        <span class="cat-count" style="background-color: ${cat.color}; color: white;">
          ${formatCompactNumber(cat.count)}
        </span>
      `;

      card.addEventListener('click', () => {
        selectCategory(cat.idx);
      });

      grid.appendChild(card);
    });
  }

  // 4. 지도 초기화
  function initMap() {
    elements.map = L.map('map', {
      center: BUSAN_CENTER,
      zoom: BUSAN_DEFAULT_ZOOM,
      zoomControl: true,
      minZoom: 7,
      maxZoom: 19
    });

    const defaultTile = TILE_LAYERS[0];
    elements.tileLayer = L.tileLayer(defaultTile.url, {
      attribution: defaultTile.attribution,
      minZoom: defaultTile.minZoom || 7,
      maxZoom: defaultTile.maxZoom || 19
    }).addTo(elements.map);

    elements.markerClusterGroup = L.markerClusterGroup({
      chunkedLoading: true,
      chunkInterval: 80,
      chunkDelay: 15,
      maxClusterRadius: 60,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true
    });
    elements.map.addLayer(elements.markerClusterGroup);

    // 전체보기 모드일 때 지도 이동에 따라 마커 동적 로딩 (Viewport Optimization)
    elements.map.on('moveend', () => {
      if (state.selectedDaeIdx === null && !state.keyword && state.selectedGuIdx === null) {
        if (!state.isMapMoving) {
          renderViewportMarkers();
        }
      }
    });
  }

  // 5. 이벤트 리스너 등록
  function setupEventListeners() {
    let searchTimeout = null;
    elements.searchInput.addEventListener('input', (e) => {
      const val = e.target.value.trim();
      state.keyword = val;
      elements.clearSearchBtn.style.display = val ? 'block' : 'none';

      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        applyFilters(false);
      }, 220);
    });

    elements.clearSearchBtn.addEventListener('click', () => {
      elements.searchInput.value = '';
      state.keyword = '';
      elements.clearSearchBtn.style.display = 'none';
      applyFilters(false);
      elements.searchInput.focus();
    });

    // 구/군 선택
    elements.guSelect.addEventListener('change', (e) => {
      const guName = e.target.value;
      if (!guName) {
        state.selectedGuIdx = null;
      } else {
        const guObj = state.guMeta.find(g => g.name === guName);
        state.selectedGuIdx = guObj ? guObj.idx : null;
      }
      applyFilters(true);
    });

    // 중분류 선택
    elements.jungSelect.addEventListener('change', (e) => {
      const jVal = e.target.value;
      state.selectedJungIdx = jVal !== '' ? parseInt(jVal, 10) : null;
      applyFilters(true);
    });

    // 전체보기 버튼
    elements.allCategoryBtn.addEventListener('click', () => {
      selectCategory(null);
    });

    // 필터 초기화
    elements.resetFilterBtn.addEventListener('click', resetAllFilters);

    // 내 위치 버튼
    elements.geoBtn.addEventListener('click', handleGeolocation);
    elements.mobileGeoBtn.addEventListener('click', handleGeolocation);

    // 모바일 UI 토글
    elements.mobileSearchTrigger.addEventListener('click', () => {
      elements.sidebar.classList.add('open');
      elements.searchInput.focus();
    });

    elements.closeSidebarBtn.addEventListener('click', () => {
      elements.sidebar.classList.remove('open');
    });

    elements.mobileSheetHandle.addEventListener('click', () => {
      elements.sidebar.classList.toggle('open');
    });

    // 부산 전체보기 버튼
    elements.mapResetViewBtn.addEventListener('click', () => {
      elements.map.setView(BUSAN_CENTER, BUSAN_DEFAULT_ZOOM);
    });

    // 지도 스타일 토글
    elements.toggleTileBtn.addEventListener('click', toggleMapStyle);
  }

  // 특정 대분류 선택 처리
  function selectCategory(daeIdx) {
    state.selectedDaeIdx = daeIdx;
    state.selectedJungIdx = null;

    document.querySelectorAll('.cat-card').forEach(c => c.classList.remove('active'));
    if (daeIdx === null) {
      elements.allCategoryBtn.classList.add('active');
    } else {
      elements.allCategoryBtn.classList.remove('active');
      const card = document.getElementById(`cat-card-${daeIdx}`);
      if (card) card.classList.add('active');
    }

    updateJungDropdown(daeIdx);
    applyFilters(true);
  }

  // 중분류 드롭다운 갱신
  function updateJungDropdown(daeIdx) {
    const sel = elements.jungSelect;
    sel.innerHTML = '<option value="">중분류 전체</option>';

    if (daeIdx === null) {
      sel.disabled = false;
      state.jungList.forEach((jname, jidx) => {
        const opt = document.createElement('option');
        opt.value = jidx;
        opt.textContent = jname;
        sel.appendChild(opt);
      });
      return;
    }

    const cat = state.categoriesMeta.find(c => c.idx === daeIdx);
    if (cat && cat.jungs) {
      cat.jungs.forEach(j => {
        const opt = document.createElement('option');
        opt.value = j.idx;
        opt.textContent = `${j.name} (${j.count.toLocaleString()})`;
        sel.appendChild(opt);
      });
    }
  }

  // 6. 필터링 파이프라인
  function applyFilters(shouldFitBounds = false) {
    const daeIdx = state.selectedDaeIdx;
    const jungIdx = state.selectedJungIdx;
    const guIdx = state.selectedGuIdx;
    const kw = state.keyword.toLowerCase();

    // 전체보기 모드이고 키워드/지역 필터도 없을 때 (159,689개 전체)
    const isGlobalAll = (daeIdx === null && jungIdx === null && guIdx === null && !kw);

    if (isGlobalAll) {
      state.filteredStores = state.allStores;
      updateStatusCounters(state.filteredStores.length);
      renderViewportMarkers();
      renderStoreList();
      return;
    }

    // 조건 필터링
    const results = [];
    const all = state.allStores;
    const len = all.length;

    for (let i = 0; i < len; i++) {
      const s = all[i];
      // s: [sid(0), name(1), branch(2), dae_idx(3), jung_idx(4), so(5), gu_idx(6), dong(7), addr(8), lat(9), lng(10)]
      if (daeIdx !== null && s[3] !== daeIdx) continue;
      if (jungIdx !== null && s[4] !== jungIdx) continue;
      if (guIdx !== null && s[6] !== guIdx) continue;

      if (kw) {
        const searchTarget = `${s[1]} ${s[2] || ''} ${s[5] || ''} ${s[7] || ''} ${s[8] || ''}`.toLowerCase();
        if (!searchTarget.includes(kw)) continue;
      }

      results.push(s);
    }

    state.filteredStores = results;

    // 내 위치 거리 계산
    if (state.userCoords) {
      results.forEach(s => {
        s.distance = getDistanceKm(state.userCoords.lat, state.userCoords.lng, s[9], s[10]);
      });
      results.sort((a, b) => a.distance - b.distance);
    }

    updateStatusCounters(results.length);
    renderMarkers(results, shouldFitBounds);
    renderStoreList();
  }

  function updateStatusCounters(count) {
    elements.matchCount.textContent = count.toLocaleString();
    elements.mobileListCount.textContent = count.toLocaleString();

    let label = '';
    if (state.selectedDaeIdx !== null) {
      const cat = state.categoriesMeta.find(c => c.idx === state.selectedDaeIdx);
      if (cat) label = `${cat.icon} ${cat.name}`;
    }
    if (state.selectedGuIdx !== null) {
      const gu = state.guMeta.find(g => g.idx === state.selectedGuIdx);
      if (gu) label += (label ? ' · ' : '') + gu.name;
    }
    if (state.keyword) {
      label += (label ? ' · ' : '') + state.keyword;
    }
    elements.mobileSearchText.textContent = label || '부산 상가 검색 및 업종 필터';
  }

  // 7. 마커 렌더링
  function renderMarkers(storesList, shouldFitBounds) {
    elements.markerClusterGroup.clearLayers();
    state.markersMap.clear();

    const markers = [];
    const bounds = L.latLngBounds();

    // 렌더링 성능 보호: 한 번에 최대 10,000개 마커 클러스터링
    const targetStores = storesList.length > 10000 ? storesList.slice(0, 10000) : storesList;

    targetStores.forEach(s => {
      const cat = state.categoriesMeta[s[3]] || { color: '#475569', icon: '🏢', name: '기타' };
      
      const customIcon = L.divIcon({
        className: 'custom-pin-container',
        html: `
          <div class="custom-pin" style="background-color: ${cat.color};">
            <span class="custom-pin-inner">${cat.icon}</span>
          </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 28],
        popupAnchor: [0, -26]
      });

      const marker = L.marker([s[9], s[10]], { icon: customIcon });
      marker.bindPopup(() => createPopupContent(s, cat));

      marker.on('click', () => {
        highlightStoreCard(s[0]);
      });

      markers.push(marker);
      state.markersMap.set(s[0], marker);
      bounds.extend([s[9], s[10]]);
    });

    elements.markerClusterGroup.addLayers(markers);

    if (shouldFitBounds && markers.length > 0) {
      state.isMapMoving = true;
      elements.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
      setTimeout(() => { state.isMapMoving = false; }, 500);
    }
  }

  // 전체보기 모드일 때 화면 뷰포트 영역 내 마커 로딩
  function renderViewportMarkers() {
    if (!elements.map) return;
    const bounds = elements.map.getBounds();
    const zoom = elements.map.getZoom();

    const inViewStores = [];
    const all = state.allStores;
    const len = all.length;

    // 뷰포트 내 상가 필터
    for (let i = 0; i < len; i++) {
      const s = all[i];
      const lat = s[9];
      const lng = s[10];
      if (bounds.contains([lat, lng])) {
        inViewStores.push(s);
        // 저배율에서는 과도한 마커 생성 방지
        if (zoom < 13 && inViewStores.length >= 3000) break;
        if (zoom >= 13 && inViewStores.length >= 8000) break;
      }
    }

    renderMarkers(inViewStores, false);
  }

  // 8. 팝업 콘텐츠 HTML 생성
  function createPopupContent(s, cat) {
    // s: [sid(0), name(1), branch(2), dae_idx(3), jung_idx(4), so(5), gu_idx(6), dong(7), addr(8), lat(9), lng(10)]
    const displayName = s[1];
    const branchText = s[2] ? ` (${s[2]})` : '';
    const jungName = state.jungList[s[4]] || '';
    const soName = s[5] ? ` · ${s[5]}` : '';
    const distanceBadge = s.distance !== undefined ? 
      `<span style="color: #2563EB; font-weight: 700; font-size: 0.8rem;">📍 ${formatDistance(s.distance)}</span>` : '';

    const kakaoMapUrl = `https://map.kakao.com/link/to/${encodeURIComponent(displayName)},${s[9]},${s[10]}`;
    const naverMapUrl = `https://map.naver.com/v5/search/${encodeURIComponent(displayName + ' ' + (s[2] || ''))}`;
    const escapedAddr = (s[8] || '').replace(/'/g, "\\'");

    return `
      <div class="popup-card">
        <div class="popup-header">
          <div class="category-badge-group">
            <span class="cat-badge" style="background-color: ${cat.color};">${cat.icon} ${cat.name}</span>
            <span class="jung-badge">${jungName}${soName}</span>
          </div>
          ${distanceBadge}
        </div>
        <h3 class="popup-title">${displayName}${branchText}</h3>
        <p class="popup-addr">📍 ${s[8]}</p>
        <div class="popup-actions">
          <a href="${kakaoMapUrl}" target="_blank" rel="noopener noreferrer" class="popup-btn popup-btn-kakao">
            카카오 길찾기
          </a>
          <a href="${naverMapUrl}" target="_blank" rel="noopener noreferrer" class="popup-btn popup-btn-naver">
            네이버 지도
          </a>
          <button class="popup-btn popup-copy-btn" onclick="window.copyAddress('${escapedAddr}')">
            📋 주소 복사하기
          </button>
        </div>
      </div>
    `;
  }

  // 9. 매장 리스트 렌더링 (사이드바)
  function renderStoreList() {
    const container = elements.storeList;
    container.innerHTML = '';

    if (state.filteredStores.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>🔍 조건에 일치하는 상가가 없습니다.</p>
          <p style="font-size: 0.8rem; margin-top: 6px;">다른 업종이나 구/군을 선택해 보세요.</p>
        </div>
      `;
      return;
    }

    const displayList = state.filteredStores.slice(0, 100);
    const fragment = document.createDocumentFragment();

    displayList.forEach(s => {
      const card = document.createElement('div');
      card.className = 'store-card';
      card.id = `card-${s[0]}`;
      if (state.selectedStoreId === s[0]) card.classList.add('selected');

      const cat = state.categoriesMeta[s[3]] || { color: '#475569', icon: '🏢', name: '기타' };
      const jungName = state.jungList[s[4]] || '';
      const guName = state.guMeta[s[6]] ? state.guMeta[s[6]].name : '';
      const branchHtml = s[2] ? `<span class="card-branch">${s[2]}</span>` : '';
      const distHtml = s.distance !== undefined ? 
        `<span class="card-distance">${formatDistance(s.distance)}</span>` : '';

      card.innerHTML = `
        <div class="card-top">
          <div class="category-badge-group">
            <span class="cat-badge" style="background-color: ${cat.color};">${cat.icon} ${cat.name}</span>
            <span class="jung-badge">${jungName}</span>
          </div>
          ${distHtml}
        </div>
        <div class="card-name">${s[1]}${branchHtml}</div>
        <div class="card-so">🏷️ ${s[5] || jungName}</div>
        <div class="card-addr">${s[8]}</div>
        <div class="card-footer">
          <span class="card-district-tag">${guName} ${s[7] || ''}</span>
          <span>상세보기 &rarr;</span>
        </div>
      `;

      card.addEventListener('click', () => {
        selectStore(s);
      });

      fragment.appendChild(card);
    });

    container.appendChild(fragment);

    if (state.filteredStores.length > 100) {
      const notice = document.createElement('div');
      notice.style.cssText = 'text-align:center; padding:12px; font-size:0.8rem; color:#64748B;';
      notice.textContent = `(전체 ${state.filteredStores.length.toLocaleString()}개 중 상위 100개를 표시합니다. 지도를 확대하면 더 자세히 볼 수 있습니다)`;
      container.appendChild(notice);
    }
  }

  // 10. 특정 매장 선택
  function selectStore(s) {
    state.selectedStoreId = s[0];
    highlightStoreCard(s[0]);

    if (window.innerWidth <= 900) {
      elements.sidebar.classList.remove('open');
    }

    let marker = state.markersMap.get(s[0]);
    if (!marker) {
      // 마커가 아직 클러스터에 없으면 직접 생성하여 팝업
      const cat = state.categoriesMeta[s[3]] || { color: '#475569', icon: '🏢', name: '기타' };
      const customIcon = L.divIcon({
        className: 'custom-pin-container',
        html: `<div class="custom-pin" style="background-color: ${cat.color};"><span class="custom-pin-inner">${cat.icon}</span></div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 28],
        popupAnchor: [0, -26]
      });
      marker = L.marker([s[9], s[10]], { icon: customIcon });
      marker.bindPopup(() => createPopupContent(s, cat));
      elements.markerClusterGroup.addLayer(marker);
      state.markersMap.set(s[0], marker);
    }

    elements.map.setView([s[9], s[10]], 18, { animate: true });
    setTimeout(() => {
      elements.markerClusterGroup.zoomToShowLayer(marker, () => {
        marker.openPopup();
      });
    }, 280);
  }

  function highlightStoreCard(storeId) {
    state.selectedStoreId = storeId;
    document.querySelectorAll('.store-card').forEach(c => c.classList.remove('selected'));
    const card = document.getElementById(`card-${storeId}`);
    if (card) {
      card.classList.add('selected');
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  // 11. GPS 내 위치
  function handleGeolocation() {
    if (!navigator.geolocation) {
      showToast('이 브라우저는 위치 정보(GPS)를 지원하지 않습니다.');
      return;
    }

    showToast('현재 위치를 확인하고 있습니다...');

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        state.userCoords = { lat, lng };

        if (state.userMarker) {
          elements.map.removeLayer(state.userMarker);
        }

        const userIcon = L.divIcon({
          className: 'user-geo-marker',
          html: `<div style="background:#2563EB; width:16px; height:16px; border-radius:50%; border:3px solid white; box-shadow:0 0 10px rgba(37,99,235,0.7);"></div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11]
        });

        state.userMarker = L.marker([lat, lng], { icon: userIcon }).addTo(elements.map);
        state.userMarker.bindPopup('<b>현재 내 위치</b>').openPopup();

        elements.geoBtn.classList.add('active');
        showToast('내 위치 주변 상가를 가까운 순으로 정렬했습니다.');

        applyFilters(false);
        elements.map.setView([lat, lng], 16, { animate: true });
      },
      (err) => {
        console.warn('Geolocation error:', err);
        showToast('위치 정보 접근 권한이 거부되었거나 위치를 가져올 수 없습니다.');
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  // 12. 필터 초기화
  function resetAllFilters() {
    state.selectedDaeIdx = null;
    state.selectedJungIdx = null;
    state.selectedGuIdx = null;
    state.keyword = '';
    state.selectedStoreId = null;

    elements.searchInput.value = '';
    elements.clearSearchBtn.style.display = 'none';
    elements.guSelect.value = '';
    elements.jungSelect.innerHTML = '<option value="">중분류 전체</option>';
    updateJungDropdown(null);

    document.querySelectorAll('.cat-card').forEach(c => c.classList.remove('active'));
    elements.allCategoryBtn.classList.add('active');

    applyFilters(false);
    elements.map.setView(BUSAN_CENTER, BUSAN_DEFAULT_ZOOM);
    showToast('부산 전체 보기로 초기화되었습니다.');
  }

  // 13. 지도 타일 스타일 변경
  function toggleMapStyle() {
    state.currentTileIndex = (state.currentTileIndex + 1) % TILE_LAYERS.length;
    const layerConf = TILE_LAYERS[state.currentTileIndex];

    elements.map.removeLayer(elements.tileLayer);
    elements.tileLayer = L.tileLayer(layerConf.url, {
      attribution: layerConf.attribution,
      minZoom: layerConf.minZoom || 7,
      maxZoom: layerConf.maxZoom || 19
    }).addTo(elements.map);

    showToast(`지도 스타일: ${layerConf.name}`);
  }

  // 14. 유틸리티 함수
  function formatCompactNumber(num) {
    if (num >= 10000) {
      return (num / 10000).toFixed(1) + '만';
    }
    return num.toLocaleString();
  }

  function getDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function deg2rad(deg) {
    return deg * (Math.PI / 180);
  }

  function formatDistance(distKm) {
    if (distKm < 1) {
      return `${Math.round(distKm * 1000)}m`;
    }
    return `${distKm.toFixed(1)}km`;
  }

  function showToast(msg) {
    const toast = elements.toast;
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 2400);
  }

  window.copyAddress = function (text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        showToast('주소가 클립보드에 복사되었습니다! 📋');
      }).catch(() => {
        fallbackCopy(text);
      });
    } else {
      fallbackCopy(text);
    }
  };

  function fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      showToast('주소가 클립보드에 복사되었습니다! 📋');
    } catch (e) {
      showToast('주소 복사에 실패했습니다.');
    }
    document.body.removeChild(textarea);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
