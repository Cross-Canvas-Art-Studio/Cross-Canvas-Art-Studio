import os
os.environ['LOG_DIR'] = './data_test/logs'
os.environ['PROJECTS_DIR'] = './data_test/projects'
os.environ['USERS_DB'] = './data_test/users.db'

import unittest
import re
import numpy as np
from App import palette_manager, image_manager, user_manager

class TestCrossCanvas(unittest.TestCase):
    def setUp(self):
        palette_manager._ensure_cache()

    def test_nearest_indices_correctness(self):
        # Test that nearest_indices correctly maps colors
        # Red should map to RED or CHY, White to WHT, etc.
        rgb = np.array([
            [255, 255, 255],  # White
            [255, 0, 0],      # Red
            [0, 255, 0],      # Lime/Green
        ], dtype=np.float64)
        
        indices = palette_manager.nearest_indices(rgb)
        self.assertEqual(len(indices), 3)
        
        # Resolve indices back to codes
        codes = [palette_manager.get_entry(idx)["code"] for idx in indices]
        self.assertIn("WHT", codes)
        self.assertIn("RED", codes)
        self.assertTrue(any(c in ["LIM", "SPR", "KEL"] for c in codes))

    def test_nearest_indices_empty_input(self):
        rgb = np.empty((0, 3), dtype=np.float64)
        indices = palette_manager.nearest_indices(rgb)
        self.assertEqual(len(indices), 0)

    def test_nearest_indices_deduplication(self):
        # Multiple duplicate pixels should map to identical indices
        rgb = np.array([
            [255, 255, 255],
            [255, 255, 255],
            [0, 0, 0],
            [0, 0, 0],
        ], dtype=np.float64)
        indices = palette_manager.nearest_indices(rgb)
        self.assertEqual(indices[0], indices[1])
        self.assertEqual(indices[2], indices[3])
        self.assertNotEqual(indices[0], indices[2])

class TestUserManager(unittest.TestCase):
    def setUp(self):
        self.old_users_db = user_manager.USERS_DB
        user_manager.USERS_DB = "./users_test.db"
        # Start from a clean database. Without this the suite is not
        # repeatable: a leftover file makes the second run fail with
        # "Username already exists".
        self._remove_db()
        user_manager.init_db()

    @staticmethod
    def _remove_db():
        for suffix in ("", "-shm", "-wal"):
            path = "./users_test.db" + suffix
            if os.path.exists(path):
                try:
                    os.remove(path)
                except Exception:
                    pass

    def test_create_guest_user_optimized(self):
        guest = user_manager.create_guest_user()
        self.assertTrue(guest["is_guest"])
        self.assertEqual(guest["role"], "guest")
        
        # Verify the saved hash starts with '!!unusable-'
        row = user_manager.get_user_by_id(guest["user_id"])
        self.assertIsNotNone(row)
        self.assertTrue(row["password_hash"].startswith("!!unusable-"))
        
        # Verify verify_password rejects it cleanly
        self.assertFalse(user_manager.verify_password("any_password", row["password_hash"]))

    def test_create_user_passwordless_optimized(self):
        user = user_manager.create_user_passwordless("test_passkey_user")
        self.assertEqual(user["role"], "user")
        
        # Verify the saved hash starts with '!!unusable-'
        row = user_manager.get_user_by_id(user["user_id"])
        self.assertIsNotNone(row)
        self.assertTrue(row["password_hash"].startswith("!!unusable-"))
        
        # Verify verify_password rejects it cleanly
        self.assertFalse(user_manager.verify_password("any_password", row["password_hash"]))

class TestConfigInvariants(unittest.TestCase):
    """Guards against the silent, user-visible bugs fixed in the Tier 1 work."""

    def _read(self, *parts):
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), *parts)
        with open(path, encoding='utf-8') as fh:
            return fh.read()

    def test_grid_ceiling_matches_project_store(self):
        # A 501-1000 chart used to be drawable (config.json said max_size 1000)
        # but rejected by the store (MAX_GRID_SIZE was 500) — the user could
        # paint a chart that then silently refused to save.
        import json
        from App import project_manager
        cfg = json.loads(self._read('config.json'))
        self.assertEqual(cfg['grid']['max_size'], project_manager.MAX_GRID_SIZE)
        self.assertEqual(cfg['grid']['min_size'], 5)

    def test_frontend_grid_inputs_match_backend_cap(self):
        from App import project_manager
        html = self._read('templates', 'index.html')
        cap = project_manager.MAX_GRID_SIZE
        self.assertIn('id="gridWidth" min="5" max="%d"' % cap, html)
        self.assertIn('id="gridHeight" min="5" max="%d"' % cap, html)

    def test_static_adapter_grid_cap_matches_backend(self):
        from App import project_manager
        js = self._read('static', 'static-adapter.js')
        self.assertIn('max_size: %d' % project_manager.MAX_GRID_SIZE, js)

    def test_grid_ceiling_is_enforced_consistently(self):
        # The original bug: config.json allowed 1000 while the store capped at
        # 500, so a 501-999 chart was drawable in the UI but refused to save.
        # The ceiling is 500 everywhere now, so the store must accept exactly
        # the cap and reject anything past it, matching what the UI permits.
        from App import project_manager
        cap = project_manager.MAX_GRID_SIZE

        clean, width, height = project_manager._sanitize_grid([[0] for _ in range(cap)])
        self.assertEqual(height, cap)
        self.assertEqual(width, 1)
        self.assertEqual(len(clean), cap)

        with self.assertRaises(ValueError):
            project_manager._sanitize_grid([[0] for _ in range(cap + 1)])
        with self.assertRaises(ValueError):
            project_manager._sanitize_grid([[0] * (cap + 1)])

    def test_every_palette_entry_has_a_distinct_symbol(self):
        from App import palette_manager
        palette = palette_manager.get_palette()
        symbols = [e['symbol'] for e in palette]
        self.assertEqual(len(symbols), len(set(symbols)),
                         'every palette entry needs its own glyph')
        self.assertTrue(all(0 <= s < palette_manager.SYMBOL_COUNT for s in symbols))

    def test_symbol_count_matches_frontend_glyph_table(self):
        # If the palette grows past the glyph table, entries wrap onto duplicate
        # glyphs and two colours become indistinguishable in a greyscale print.
        from App import palette_manager
        js = self._read('static', 'symbols.js')
        glyphs = re.findall(r'^\s{4}\[(?:L|C|D|P)\(', js, flags=re.M)
        self.assertEqual(len(glyphs), palette_manager.SYMBOL_COUNT,
                         'SYMBOL_COUNT in palette_manager.py must match symbols.js')
        self.assertGreaterEqual(palette_manager.SYMBOL_COUNT,
                                palette_manager.palette_size())


class TestPwaAndNotes(unittest.TestCase):
    """The installable/offline shell, the per-chart notes, and the HTML/JS
    wiring that keeps the Flask app and the static build in step."""

    def _read(self, *parts):
        root = os.path.dirname(os.path.abspath(__file__))
        path = os.path.join(root, *parts)
        if not os.path.exists(path):
            path = os.path.join(os.path.dirname(root), *parts)
        with open(path, encoding='utf-8') as fh:
            return fh.read()

    def test_pwa_assets_exist(self):
        static = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static')
        for name in ('manifest.webmanifest', 'sw.js', 'pwa.js',
                     'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'):
            self.assertTrue(os.path.exists(os.path.join(static, name)),
                            'App/static/%s is missing' % name)

    def test_manifest_has_icons_and_standalone_display(self):
        import json
        manifest = json.loads(self._read('static', 'manifest.webmanifest'))
        self.assertEqual(manifest['display'], 'standalone')
        sizes = {i['sizes'] for i in manifest['icons']}
        self.assertIn('192x192', sizes)
        self.assertIn('512x512', sizes)
        self.assertTrue(any(i.get('purpose') == 'maskable' for i in manifest['icons']),
                        'a maskable icon is required for Android')

    def test_service_worker_never_caches_api(self):
        # The API must stay live: caching it would serve stale designer data.
        sw = self._read('static', 'sw.js')
        self.assertIn("'/api/'", sw)
        self.assertIn('skipWaiting', sw)

    def test_every_page_links_the_manifest_and_install_button(self):
        for tpl in ('index.html', 'pixelator.html', 'resizer.html',
                    'palette.html', 'ascii.html'):
            html = self._read('templates', tpl)
            self.assertIn('rel="manifest"', html, tpl)
            self.assertIn('theme-color', html, tpl)
            self.assertIn('id="installBtn"', html, tpl)
            self.assertIn("filename='pwa.js'", html, tpl)

    def test_static_build_publishes_pwa_files(self):
        build = self._read('.github', 'scripts', 'build_site.py')
        for name in ('manifest.webmanifest', 'sw.js', 'pwa.js',
                     'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'):
            self.assertIn("'%s'" % name, build,
                          '%s must be copied into the static build' % name)

    def test_index_has_locate_shade_card_and_notes(self):
        html = self._read('templates', 'index.html')
        for frag in ('id="toggleLocate"', 'id="locateOptions"', 'id="locateNextBtn"',
                     'id="shadeCardBtn"', 'id="shadeCardModal"',
                     'id="progressStats"', 'id="projectNotes"'):
            self.assertIn(frag, html, frag)

    def test_app_js_only_calls_canvas_methods_that_exist(self):
        # A rename on one side of the canvas boundary otherwise only throws at
        # click time in a browser, which no template test can see.
        js = self._read('static', 'app.js')
        renderer = self._read('static', 'canvas-renderer.js')
        called = set(re.findall(r'state\.canvas\.([A-Za-z_]\w*)\(', js))
        missing = sorted(m for m in called if (m + '(') not in renderer)
        self.assertEqual(missing, [],
                         'app.js calls missing canvas methods: %s' % missing)

    def test_project_notes_round_trip(self):
        from App import project_manager
        grid = [[0, -1], [-1, 1]]
        meta = project_manager.create_project('Note test', grid, notes='change to DMC 666')
        try:
            doc = project_manager.get_project(meta['id'])
            self.assertEqual(doc['notes'], 'change to DMC 666')
            project_manager.update_project(meta['id'], 'Note test', grid, notes='updated')
            self.assertEqual(project_manager.get_project(meta['id'])['notes'], 'updated')
            # Omitting notes on an update must not wipe the stored value.
            project_manager.update_project(meta['id'], 'Note test', grid)
            self.assertEqual(project_manager.get_project(meta['id'])['notes'], 'updated')
        finally:
            project_manager.delete_project(meta['id'])


class TestChartImport(unittest.TestCase):
    """Imported-chart (markup) documents: the store fields, the IndexedDB shim
    shipping in both builds, and the designer's chart controls."""

    def _read(self, *parts):
        root = os.path.dirname(os.path.abspath(__file__))
        path = os.path.join(root, *parts)
        if not os.path.exists(path):
            path = os.path.join(os.path.dirname(root), *parts)
        with open(path, encoding='utf-8') as fh:
            return fh.read()

    def test_image_store_exists_and_is_shipped(self):
        static = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static')
        self.assertTrue(os.path.exists(os.path.join(static, 'image-store.js')))
        html = self._read('templates', 'index.html')
        self.assertIn("filename='image-store.js'", html)
        build = self._read('.github', 'scripts', 'build_site.py')
        self.assertIn("'image-store.js'", build)

    def test_index_has_chart_import_controls(self):
        html = self._read('templates', 'index.html')
        for frag in ('data-source-tab="chart"', 'id="sourceChart"', 'id="chartInput"',
                     'id="chartImportBtn"', 'id="chartConvertBtn"', 'id="chartShow"',
                     'id="readChartBtn"', 'id="toolPick"'):
            self.assertIn(frag, html, frag)

    def test_chart_document_round_trip(self):
        from App import project_manager
        grid = [[-1, -1], [-1, -1]]
        source = {'id': 'img_1', 'name': 'chart.png', 'mime': 'image/png', 'w': 1200, 'h': 900}
        fit = {'fit': 'stretch', 'scaleX': 1.0, 'scaleY': 1.0, 'offsetX': 0.0, 'offsetY': 0.0}
        meta = project_manager.create_project('Chart', grid, kind='chart',
                                              source=source, fit=fit)
        try:
            self.assertEqual(meta['kind'], 'chart')
            doc = project_manager.get_project(meta['id'])
            self.assertEqual(doc['kind'], 'chart')
            self.assertEqual(doc['source']['name'], 'chart.png')
            self.assertEqual(doc['fit']['fit'], 'stretch')
            # A partial update must NOT wipe the chart fields.
            project_manager.update_project(meta['id'], 'Chart', grid)
            doc = project_manager.get_project(meta['id'])
            self.assertEqual(doc['kind'], 'chart')
            self.assertEqual(doc['source']['id'], 'img_1')
        finally:
            project_manager.delete_project(meta['id'])

    def test_pattern_is_the_default_kind(self):
        from App import project_manager
        meta = project_manager.create_project('Plain', [[0, -1], [-1, 1]])
        try:
            self.assertEqual(meta['kind'], 'pattern')
            doc = project_manager.get_project(meta['id'])
            self.assertIsNone(doc.get('source'))
            self.assertIsNone(doc.get('fit'))
        finally:
            project_manager.delete_project(meta['id'])

    def test_source_and_fit_junk_is_sanitised(self):
        from App import project_manager
        self.assertIsNone(project_manager._sanitize_source('nope'))
        self.assertIsNone(project_manager._sanitize_source({}))
        self.assertIsNone(project_manager._sanitize_fit({'scaleX': 'x', 'fit': 'nope'}))
        # Booleans are ints in Python, and a negative size is not a size.
        self.assertEqual(project_manager._sanitize_source({'id': 'a', 'w': True, 'h': -5}),
                         {'id': 'a'})

    def test_app_js_chart_methods_exist_on_the_canvas(self):
        # The chart UI drives the substrate + markable-cells API; a rename on
        # either side would only fail at click time in a browser.
        js = self._read('static', 'app.js')
        renderer = self._read('static', 'canvas-renderer.js')
        for method in ('setSubstratePages', 'setAllCellsStitchable'):
            self.assertIn(method + '(', renderer, method)
            self.assertIn(method + '(', js, method)
        # The substrate flag itself is a renderer concern now (pages imply it),
        # but it must still exist for pattern-mode callers to switch it off.
        self.assertIn('setOverlayUnder(', renderer)

    def test_index_has_page_controls(self):
        html = self._read('templates', 'index.html')
        for frag in ('id="pagesPanel"', 'id="pagesList"', 'id="pageEditor"',
                     'id="addPageBtn"', 'id="addPageInput"', 'id="joinRightBtn"',
                     'id="joinBelowBtn"', 'id="pageCol"', 'id="pageRow"',
                     'id="pageCols"', 'id="pageRows"', 'id="pageRotateBtn"',
                     'id="pageRemoveBtn"'):
            self.assertIn(frag, html, frag)
        # A whole multi-page chart can be picked in one go.
        self.assertIn('id="chartInput" accept="image/*" multiple', html)

    def test_app_js_page_methods_exist_on_the_canvas(self):
        # The page UI drives the multi-page substrate; a rename on either side
        # would only fail at click time in a browser.
        js = self._read('static', 'app.js')
        renderer = self._read('static', 'canvas-renderer.js')
        for method in ('setSubstratePages', 'setActivePage', 'setPageGeometry',
                       'resizeGrid', 'pageBounds', 'renderSubstrate'):
            self.assertIn(method + '(', renderer, method)
        for call in ('setSubstratePages(', 'setActivePage(', 'resizeGrid(',
                     'pageBounds(', 'renderSubstrate(', 'setActivePageGeometry('):
            self.assertIn(call, js, call)
        # The legacy single-page transform has to stay readable as a page.
        self.assertIn('CrossStitchCanvas.pageFromFit = function', renderer)
        self.assertIn('pageFromFit(', js)

    def test_pages_round_trip(self):
        from App import project_manager
        grid = [[-1, -1, -1, -1], [-1, -1, -1, -1]]
        pages = [
            {'id': 'img_a', 'name': 'p1.png', 'mime': 'image/png', 'w': 900, 'h': 1200,
             'col': 0.0, 'row': 0.0, 'cols': 60.0, 'rows': 80.0, 'rot': 0},
            {'id': 'img_b', 'name': 'p2.png', 'mime': 'image/png', 'w': 900, 'h': 1200,
             'col': 60.0, 'row': 0.0, 'cols': 60.0, 'rows': 80.0, 'rot': 90,
             'crop': {'x': 0.05, 'y': 0.05, 'w': 0.9, 'h': 0.9}},
        ]
        meta = project_manager.create_project('Joined', grid, kind='chart', pages=pages)
        try:
            doc = project_manager.get_project(meta['id'])
            self.assertEqual(len(doc['pages']), 2)
            self.assertEqual(doc['pages'][1]['id'], 'img_b')
            self.assertEqual(doc['pages'][1]['rot'], 90)
            self.assertEqual(doc['pages'][1]['crop']['w'], 0.9)
            self.assertEqual(doc['pages'][1]['cols'], 60.0)
            # The list must stay lean: geometry lives in the document, not here.
            self.assertNotIn('pages', meta)
            # A partial update must NOT wipe the page list.
            project_manager.update_project(meta['id'], 'Joined', grid)
            doc = project_manager.get_project(meta['id'])
            self.assertEqual(len(doc['pages']), 2)
        finally:
            project_manager.delete_project(meta['id'])

    def test_pages_junk_is_sanitised(self):
        from App import project_manager
        self.assertIsNone(project_manager._sanitize_pages('nope'))
        self.assertIsNone(project_manager._sanitize_pages([]))
        # No id, or no positive size, is not a page.
        self.assertIsNone(project_manager._sanitize_pages([{'col': 0, 'cols': 10, 'rows': 10}]))
        self.assertIsNone(project_manager._sanitize_pages(
            [{'id': 'a', 'col': 0, 'cols': 0, 'rows': 10}]))
        # Booleans are ints in Python, so a boolean size must not sneak through.
        self.assertIsNone(project_manager._sanitize_pages(
            [{'id': 'a', 'col': 0, 'cols': True, 'rows': 10}]))
        clean = project_manager._sanitize_pages([
            {'id': 'a', 'col': -5, 'row': 2.5, 'cols': 10, 'rows': 20, 'rot': 95},
            {'id': 'b', 'col': 0, 'row': 0, 'cols': 10, 'rows': 20, 'rot': 270,
             'crop': {'x': 0, 'y': 0, 'w': 0, 'h': 0.5}},
        ])
        # A page above/left of the origin is legitimate and must survive.
        self.assertEqual(clean[0]['col'], -5.0)
        self.assertEqual(clean[0]['row'], 2.5)
        self.assertEqual(clean[0]['rot'], 0, 'a nonsense rotation becomes unrotated')
        self.assertEqual(clean[1]['rot'], 270)
        self.assertNotIn('crop', clean[1], 'a zero-width crop draws nothing, so it is dropped')
        # The page count is capped so one import cannot bloat the document.
        many = [{'id': 'p%d' % i, 'col': i, 'row': 0, 'cols': 1, 'rows': 1}
                for i in range(project_manager.MAX_PAGES + 10)]
        self.assertEqual(len(project_manager._sanitize_pages(many)), project_manager.MAX_PAGES)

    def test_multi_page_ceiling_matches_frontend(self):
        from App import project_manager
        renderer = self._read('static', 'canvas-renderer.js')
        self.assertIn('var MAX_SUBSTRATE_PAGES = %d;' % project_manager.MAX_PAGES, renderer)

    def test_chart_preview_is_bounded(self):
        # A picked chart is a photo, scan or screenshot and is easily thousands
        # of pixels wide. The preview MUST be constrained to its drop zone, or it
        # renders at its natural size and stretches the whole side panel off the
        # screen. Regression guard: #chartPreview was missing from the rule that
        # already bounded #uploadPreview.
        css = self._read('static', 'style.css')
        match = re.search(r'#chartPreview[^{]*\{(.*?)\}', css, re.S)
        self.assertIsNotNone(match, '#chartPreview needs a CSS rule that bounds it')
        block = match.group(1)
        self.assertIn('max-width', block)
        self.assertIn('max-height', block)
        # And the "Drop a chart" prompt has to step aside once one is showing.
        self.assertIn(':has(#chartPreview:not([hidden]))', css)

    def test_chart_preview_hides_the_prompt_on_a_multi_page_pick(self):
        # Picking several sheets previews only the first; the prompt must still
        # hide, and importing must not fall back to a single `chartFile`.
        js = self._read('static', 'app.js')
        self.assertIn('onChartSelected(this.files)', js)
        self.assertNotIn('onChartSelected(this.files[0])', js)


class TestStitchTypes(unittest.TestCase):
    """Stitch types (fractional stitches + backstitch). A cell's COLOUR lives in
    the grid; these two layers say what MARK to make and which cell borders carry
    an outline, so they have to survive a save exactly like the colours do."""

    def _read(self, *parts):
        root = os.path.dirname(os.path.abspath(__file__))
        path = os.path.join(root, *parts)
        if not os.path.exists(path):
            path = os.path.join(os.path.dirname(root), *parts)
        with open(path, encoding='utf-8') as fh:
            return fh.read()

    def test_layer_runs_are_validated(self):
        from App import project_manager
        # A well-formed layer passes through unchanged.
        good = '0:4,16:2,0:6'
        self.assertEqual(project_manager._sanitize_layer_runs(good, 100), good)
        self.assertIsNone(project_manager._sanitize_layer_runs('', 100))
        self.assertIsNone(project_manager._sanitize_layer_runs(None, 100))
        self.assertIsNone(project_manager._sanitize_layer_runs(123, 100))
        for bad in ('nonsense', '4', '4:x', 'a:2', '4:0', '999:2', '4:-1'):
            with self.assertRaises(ValueError, msg=bad):
                project_manager._sanitize_layer_runs(bad, 100)
        # A layer claiming more cells than the grid has is not trustworthy.
        with self.assertRaises(ValueError):
            project_manager._sanitize_layer_runs('4:1000', 10)
        with self.assertRaises(ValueError):
            project_manager._sanitize_layer_runs('4:' + '0' * 7, 10)

    def test_layers_round_trip_through_the_store(self):
        from App import project_manager
        grid = [[-1, 0], [1, -1]]
        frac = '0:1,16:1,0:2'
        back = '0:3,2:1,0:4'
        meta = project_manager.create_project('Stitches', grid, frac=frac, back=back)
        try:
            doc = project_manager.get_project(meta['id'])
            self.assertEqual(doc['frac'], frac)
            self.assertEqual(doc['back'], back)
            # An ordinary pattern stores neither, so its document is unchanged.
            self.assertNotIn('frac', meta)
            # A partial update must NOT wipe the layers...
            project_manager.update_project(meta['id'], 'Stitches', grid)
            doc = project_manager.get_project(meta['id'])
            self.assertEqual(doc['frac'], frac)
            self.assertEqual(doc['back'], back)
            # ...but an explicit empty string clears them, which is what
            # "I removed all the backstitch" has to be able to do.
            project_manager.update_project(meta['id'], 'Stitches', grid, back='')
            doc = project_manager.get_project(meta['id'])
            self.assertIsNone(doc['back'])
            self.assertEqual(doc['frac'], frac, 'clearing one layer kept the other')
        finally:
            project_manager.delete_project(meta['id'])

    def test_layer_ceiling_matches_the_frontend(self):
        from App import project_manager
        renderer = self._read('static', 'canvas-renderer.js')
        expected = project_manager.MAX_GRID_SIZE * project_manager.MAX_GRID_SIZE * 4
        self.assertEqual(project_manager.MAX_LAYER_BYTES, expected)
        self.assertIn(
            'CrossStitchCanvas.MAX_LAYER_LENGTH = 500 * 500 * BACK_EDGES;',
            renderer,
            'the renderer must refuse a decoded layer beyond the grid ceiling too')

    def test_index_offers_every_stitch_type(self):
        html = self._read('templates', 'index.html')
        renderer = self._read('static', 'canvas-renderer.js')
        for frag in ('id="stitchPart"', 'id="toolBack"', 'id="stitchPartHint"'):
            self.assertIn(frag, html, frag)

        # PARITY: every value the dropdown offers must be exactly the flag set the
        # renderer defines. Hard-coded numbers in the template would otherwise
        # drift into drawing a different stitch than the label promises.
        def flag(name):
            m = re.search(r'var FRAC_%s = (\d+);' % name, renderer)
            self.assertIsNotNone(m, 'FRAC_%s is missing from the renderer' % name)
            return int(m.group(1))

        nw, ne, se, sw = flag('NW'), flag('NE'), flag('SE'), flag('SW')
        slash, bslash = flag('SLASH'), flag('BACKSLASH')
        expected = {
            0,
            slash, bslash,
            nw, ne, se, sw,
            nw | slash, ne | bslash, se | slash, sw | bslash,
        }
        offered = set(int(v) for v in re.findall(
            r'<option value="(\d+)"[^>]*>(?:Full|Half|Quarter|Three-quarter)', html))
        self.assertEqual(offered, expected,
                         'the stitch-type dropdown and the renderer disagree')

    def test_fractional_and_backstitch_reach_every_exporter(self):
        # A partial stitch and an outline are REAL stitching, so unlike the
        # progress or spotlight overlays they must appear in the exports. The one
        # shared drawChart is what guarantees it; this pins that the layers are
        # handed to it (rather than drawn on-screen only).
        renderer = self._read('static', 'canvas-renderer.js')
        self.assertIn('frac: this.frac,', renderer)
        self.assertIn('back: this.back,', renderer)
        self.assertIn('drawFractional(', renderer)
        self.assertIn('drawBackEdges(', renderer)
        for exporter in ('exportBlob', 'exportSvg', 'renderTo'):
            self.assertIn(exporter + '(', renderer, exporter)

    def test_app_js_uses_the_layer_api(self):
        js = self._read('static', 'app.js')
        renderer = self._read('static', 'canvas-renderer.js')
        for method in ('setStitchPart', 'getLayers', 'setLayers', 'fracAt',
                       'backEdgeAt', 'backSegmentCount', 'fractionalCount'):
            self.assertIn(method + '(', renderer, method)
        for call in ('setStitchPart(', 'getLayers(', 'bytesToRuns(', 'runsToBytes('):
            self.assertIn(call, js, call)

    def test_layers_are_persisted_wherever_a_grid_is(self):
        # A layer that only travelled in the draft would be lost the moment the
        # user saved the project instead.
        js = self._read('static', 'app.js')
        adapter = self._read('static', 'static-adapter.js')
        self.assertIn('frac: layers.frac,', js)
        self.assertIn('back: layers.back,', js)
        self.assertEqual(js.count('docLayers(') >= 3, True,
                         'every load path must decode the layers')
        self.assertIn('frac: body.frac || null', adapter)
        self.assertIn('back: body.back || null', adapter)

    def test_outline_only_floss_reaches_the_legend(self):
        # A colour used ONLY for backstitch has no cells, so the legend has to be
        # built from the union of stitch counts and outline counts, or a chart
        # outlined in DMC 310 tells you to buy everything except the black.
        js = self._read('static', 'app.js')
        renderer = self._read('static', 'canvas-renderer.js')
        self.assertIn('backCounts()', renderer)
        self.assertIn('backCounts()', js)
        self.assertIn('function legendRows()', js)
        # One row per floss, and the outline length is carried on it.
        self.assertIn('slot(parseInt(k, 10)).back = backs[k];', js)
        self.assertIn('backstitch: r.back || 0,', js)
        # The estimated skeins must include the outline, or an outline-only
        # colour would be reported as needing no floss at all.
        self.assertIn('function stitchEquiv(', js)
        self.assertIn('skn.skeinsFor(stitchEquiv(u), count, raw)', js)
        # The legend and the JSON export must read the SAME rows.
        self.assertIn('var used = legendRows();', js)
        self.assertIn('legendRows().map(', js)


class TestBlendedThreads(unittest.TestCase):
    """Phase 6: blended threads. A blend is two flosses held together in one
    stitch, which is how a chart shows a shade you cannot buy. The grid keeps the
    PRIMARY colour, so every count, legend row and skein estimate keeps working;
    the blend layer names the partner."""

    def _read(self, *parts):
        root = os.path.dirname(os.path.abspath(__file__))
        path = os.path.join(root, *parts)
        if not os.path.exists(path):
            path = os.path.join(os.path.dirname(root), *parts)
        with open(path, encoding='utf-8') as fh:
            return fh.read()

    def test_a_blend_shares_the_layer_codec(self):
        from App import project_manager
        # The partner is stored as palette index + 1, exactly like ``back``, so
        # the same validator and the same browser codec apply.
        self.assertEqual(project_manager._sanitize_layer_runs('4:2,0:1', 100),
                         '4:2,0:1')
        self.assertIsNone(project_manager._sanitize_layer_runs('', 100))
        for bad in ('x:2', '4:0', '300:1', '4:-1'):
            with self.assertRaises(ValueError, msg=bad):
                project_manager._sanitize_layer_runs(bad, 100)
        # More blended cells than the grid has is not trustworthy.
        with self.assertRaises(ValueError):
            project_manager._sanitize_layer_runs('4:1000', 10)

    def test_blend_round_trips_through_the_store(self):
        from App import project_manager
        grid = [[-1, 0], [1, -1]]
        blend = '0:1,3:1,0:2'
        meta = project_manager.create_project('Blend', grid, blend=blend)
        try:
            doc = project_manager.get_project(meta['id'])
            self.assertEqual(doc['blend'], blend)
            # An ordinary pattern stores no blend layer at all, so its document
            # is byte-for-byte what it always was.
            self.assertNotIn('blend', meta)
            # An omitted layer on an update keeps what is stored...
            project_manager.update_project(meta['id'], 'Blend', grid)
            doc = project_manager.get_project(meta['id'])
            self.assertEqual(doc['blend'], blend)
            # ...while an explicit empty string clears it, which is what
            # "I made every stitch solid again" has to be able to do.
            project_manager.update_project(meta['id'], 'Blend', grid, blend='')
            doc = project_manager.get_project(meta['id'])
            self.assertIsNone(doc['blend'])
        finally:
            project_manager.delete_project(meta['id'])

    def test_a_junk_blend_is_rejected_by_the_api(self):
        from App import project_manager
        with self.assertRaises(ValueError):
            project_manager.create_project('Bad', [[0]], blend='not a layer')

    def test_blend_travels_wherever_the_other_layers_do(self):
        app = self._read('app.py')
        js = self._read('static', 'app.js')
        adapter = self._read('static', 'static-adapter.js')
        renderer = self._read('static', 'canvas-renderer.js')
        # The API accepts it on both create and update.
        self.assertEqual(app.count("blend=data.get('blend')"), 2)
        # The UI sends it wherever it sends the other stitch-type layers:
        # draft, saved project and JSON export.
        self.assertEqual(js.count('blend: layers.blend,'), 3,
                         'draft, project and export must all carry the blend')
        self.assertIn('blend: layerRuns(L.blend),', js)
        self.assertIn('blend: layerBytes(doc && doc.blend, w * h),', js)
        # ...and every load path hands it back to the renderer.
        for frag in ('dl.blend', 'pl.blend', 'jl.blend'):
            self.assertIn(frag, js, frag)
        self.assertIn('blend: body.blend || null', adapter)
        self.assertIn(
            'blend: body.blend !== undefined ? body.blend : store[id].blend',
            adapter)
        # The renderer must keep the layer through a resize and a crop.
        self.assertIn('this.blend = newBlend;', renderer)
        self.assertIn('this.blend = outBlend;', renderer)

    def test_index_offers_blended_threads(self):
        html = self._read('templates', 'index.html')
        js = self._read('static', 'app.js')
        for frag in ('id="blendOn"', 'id="blendWith"', 'id="blendHint"'):
            self.assertIn(frag, html, frag)
        # The partner list is built from the palette the build actually ships,
        # so choosing a partner can never name a floss that is not paintable.
        self.assertIn('function buildBlendOptions()', js)
        self.assertIn('state.palette.forEach(function (e) {', js)
        self.assertIn('state.canvas.setBlendPartner(', js)
        # Painting with the box ticked is what sets a blend, and the canvas is
        # only told about a partner while blending is on.
        self.assertIn('function blendActive()', js)
        self.assertIn('blendActive() ? state.blendIndex : -1', js)

    def test_a_blend_charges_half_a_stitch_to_each_floss(self):
        js = self._read('static', 'app.js')
        # A blend uses half a stitch of thread of EACH colour, and the stitch is
        # taken back off the primary's solid count so it is never bought twice.
        self.assertIn('slot(a).count -= n;', js)
        self.assertIn('slot(a).blendHalf += n * 0.5;', js)
        self.assertIn('slot(b).blendHalf += n * 0.5;', js)
        self.assertIn('(u.blendHalf || 0)', js)
        # A blend row is titled for TWO flosses, so it must not borrow one of
        # their DMC matches and put a wrong code on the shopping list.
        self.assertIn('if (!u.isBlend) u.dmc = e.dmc || null;', js)
        self.assertIn('u.isBlend', js)
        # The pair is what the legend groups by.
        self.assertIn('blendCounts()', js)


class TestAnnotationsAndNotes(unittest.TestCase):
    """Phase 5: freehand annotations and per-cell notes. Both are the stitcher's
    own reminders — on-screen only, never exported — but part of the document."""

    def _read(self, *parts):
        root = os.path.dirname(os.path.abspath(__file__))
        path = os.path.join(root, *parts)
        if not os.path.exists(path):
            path = os.path.join(os.path.dirname(root), *parts)
        with open(path, encoding='utf-8') as fh:
            return fh.read()

    def test_annots_are_validated(self):
        from App import project_manager
        self.assertIsNone(project_manager._sanitize_annots('nope'))
        self.assertIsNone(project_manager._sanitize_annots([]))
        good = [{'k': 'arrow', 'a': [0, 1], 'b': [2.5, 3], 't': 'here', 'colour': 4}]
        self.assertEqual(project_manager._sanitize_annots(good), good)
        # An unknown kind, a missing endpoint and a non-numeric point are all
        # dropped rather than stored as a mark that cannot be drawn.
        junk = [
            {'k': 'splat', 'a': [0, 0], 'b': [1, 1]},
            {'k': 'arrow', 'a': [0, 0]},
            {'k': 'arrow', 'a': ['x', 0], 'b': [1, 1]},
            {'k': 'arrow', 'a': [0, 0], 'b': [True, 1]},
            'not a dict',
        ]
        self.assertIsNone(project_manager._sanitize_annots(junk))
        mixed = [junk[0], good[0]]
        self.assertEqual(len(project_manager._sanitize_annots(mixed)), 1)
        # A label is capped, which also bounds what the canvas has to draw.
        long = [{'k': 'text', 'a': [0, 0], 'b': [0, 0], 't': 'x' * 500}]
        self.assertEqual(len(project_manager._sanitize_annots(long)[0]['t']),
                         project_manager.MAX_NOTE_LENGTH)

    def test_cell_notes_are_validated(self):
        from App import project_manager
        self.assertIsNone(project_manager._sanitize_cell_notes('nope'))
        self.assertIsNone(project_manager._sanitize_cell_notes({}))
        self.assertEqual(project_manager._sanitize_cell_notes({'1,2': 'hi'}), {'1,2': 'hi'})
        # Malformed keys, negatives and blanks are dropped; text is trimmed.
        self.assertIsNone(project_manager._sanitize_cell_notes({
            'nope': 'x', '1': 'x', '-1,0': 'x', '0,0': '   ', 'a,b': 'x',
        }))
        self.assertEqual(project_manager._sanitize_cell_notes({'0,0': '  keep  '}), {'0,0': 'keep'})
        # Keys are normalised, so "01,2" and "1,2" cannot both exist.
        self.assertEqual(project_manager._sanitize_cell_notes({'01,2': 'x'}), {'1,2': 'x'})
        many = {('%d,0' % i): 'x' for i in range(project_manager.MAX_CELL_NOTES + 50)}
        self.assertEqual(len(project_manager._sanitize_cell_notes(many)),
                         project_manager.MAX_CELL_NOTES)

    def test_markup_layers_round_trip_through_the_store(self):
        from App import project_manager
        grid = [[0, -1], [-1, 0]]
        annots = [{'k': 'ellipse', 'a': [0.5, 0.5], 'b': [1.5, 1.5], 't': '', 'colour': 2}]
        notes = {'0,0': 'start here'}
        meta = project_manager.create_project('Markup', grid, annots=annots, cell_notes=notes)
        try:
            doc = project_manager.get_project(meta['id'])
            self.assertEqual(doc['annots'], annots)
            self.assertEqual(doc['cellNotes'], notes)
            # Omitted on update keeps them...
            project_manager.update_project(meta['id'], 'Markup', grid)
            doc = project_manager.get_project(meta['id'])
            self.assertEqual(len(doc['annots']), 1)
            self.assertEqual(doc['cellNotes'], notes)
            # ...and an explicit empty value clears them.
            project_manager.update_project(meta['id'], 'Markup', grid, annots=[])
            doc = project_manager.get_project(meta['id'])
            self.assertIsNone(doc['annots'])
            self.assertEqual(doc['cellNotes'], notes, 'clearing one layer kept the other')
        finally:
            project_manager.delete_project(meta['id'])

    def test_annotation_ceiling_matches_frontend(self):
        from App import project_manager
        renderer = self._read('static', 'canvas-renderer.js')
        for name in ('MAX_ANNOTATIONS', 'MAX_CELL_NOTES', 'MAX_NOTE_LENGTH'):
            self.assertIn(
                'var %s = %d;' % (name, getattr(project_manager, name)),
                renderer,
                '%s must match between the store and the renderer' % name)

    def test_index_has_the_markup_tools(self):
        html = self._read('templates', 'index.html')
        for frag in ('id="toolAnnot"', 'id="toolNote"', 'id="annotOptions"',
                     'id="annotArrow"', 'id="annotEllipse"', 'id="annotRect"',
                     'id="annotLabel"', 'id="annotText"', 'id="annotClearBtn"',
                     'id="annotCount"', 'id="noteOptions"', 'id="noteInput"',
                     'id="noteSaveBtn"', 'id="noteClearBtn"', 'id="noteCount"'):
            self.assertIn(frag, html, frag)

    def test_app_js_uses_the_markup_api(self):
        js = self._read('static', 'app.js')
        renderer = self._read('static', 'canvas-renderer.js')
        for method in ('setAnnotations', 'annotations', 'addAnnotation',
                       'clearAnnotations', 'removeAnnotationNear', 'setCellNote',
                       'cellNoteAt', 'cellNotesMap', 'cellNoteCount', 'setAnnotKind'):
            self.assertIn(method + '(', renderer, method)
        for call in ('setAnnotations(', 'setCellNotes(', 'cellNotesMap(',
                     'cellNoteAt(', 'setAnnotKind(', '_cellFromEvent('):
            self.assertIn(call, js, call)

    def test_markup_layers_are_persisted_but_not_exported(self):
        # They save with the document (they are your notes) yet must never reach
        # an export (a printed chart is for someone else). The renderer draws them
        # outside drawChart, which is what guarantees the second half.
        js = self._read('static', 'app.js')
        renderer = self._read('static', 'canvas-renderer.js')
        self.assertIn('function designOverlays()', js)
        self.assertIn('annots: overlays.annots,', js)
        self.assertIn('cellNotes: overlays.cellNotes,', js)
        self.assertIn('function applyOverlays(', js)
        # Drawn only from render(), never from drawChart.
        draw_chart = renderer.split('function drawChart(o) {')[1].split('function drawRulers')[0]
        self.assertNotIn('_drawAnnotations', draw_chart)
        self.assertNotIn('_drawCellNotes', draw_chart)
        self.assertIn('this._drawAnnotations();', renderer)
        self.assertIn('this._drawCellNotes();', renderer)
        # And they are part of undo, like every other edit.
        snapshot = renderer.split('_snapshot() {')[1].split('_restoreSnapshot')[0]
        self.assertIn('annots:', snapshot)
        self.assertIn('notes:', snapshot)


class TestFlossMapping(unittest.TestCase):
    """DMC floss mapping and the palette/JS parity that keeps both builds honest."""

    def _read(self, *parts):
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), *parts)
        with open(path, encoding='utf-8') as fh:
            return fh.read()

    def setUp(self):
        # Other tests may have swapped the table out; always start from the real one.
        palette_manager.load_floss_table()

    def tearDown(self):
        palette_manager.load_floss_table()

    def test_floss_table_loads_and_is_usable(self):
        self.assertGreater(palette_manager.floss_size(), 0,
                           'App/floss_dmc.json must load; a corrupt file would '
                           'silently disable every DMC label')
        meta = palette_manager.floss_meta()
        self.assertEqual(meta.get('brand'), 'DMC')
        for entry in palette_manager.get_floss():
            self.assertTrue(entry['code'])
            self.assertTrue(entry['name'])
            self.assertRegex(entry['hex'], r'^#[0-9A-Fa-f]{6}$')

    def test_floss_codes_are_unique(self):
        codes = [e['code'] for e in palette_manager.get_floss()]
        self.assertEqual(len(codes), len(set(codes)),
                         'a duplicated floss code makes a shopping list ambiguous')

    def test_every_palette_entry_maps_to_a_real_floss_entry(self):
        known = {e['code'] for e in palette_manager.get_floss()}
        unmapped = []
        for entry in palette_manager.get_palette():
            dmc = entry.get('dmc')
            if not dmc:
                unmapped.append(entry['code'])
                continue
            self.assertIn(dmc['code'], known)
            self.assertIn('lab_distance', dmc)
        self.assertEqual(unmapped, [],
                         'these palette entries have no floss match, so their '
                         'legend rows would render a blank DMC label')

    def test_known_colours_map_to_sensible_floss(self):
        self.assertEqual(palette_manager.nearest_floss_for_hex('#FFFFFF')['code'], 'B5200')
        self.assertEqual(palette_manager.nearest_floss_for_hex('#000000')['code'], '310')

    def test_semantic_override_beats_pure_colour_distance(self):
        # Nearest-colour alone sends pure-ish black to Dark Grey; a stitcher
        # buying "Black" wants 310, so floss_dmc.json pins it explicitly.
        palette = {e['code']: e for e in palette_manager.get_palette()}
        self.assertEqual(palette['BLK']['dmc']['code'], '310')

    def test_missing_table_degrades_gracefully(self):
        count = palette_manager.load_floss_table(
            os.path.join(os.path.dirname(os.path.abspath(__file__)), 'no_such_table.json'))
        self.assertEqual(count, 0)
        self.assertEqual(palette_manager.floss_size(), 0)
        self.assertIsNone(palette_manager.nearest_floss_for_hex('#123456'))
        for entry in palette_manager.get_palette():
            self.assertNotIn('dmc', entry,
                             'palette must simply omit dmc when no table is loaded')

    def test_malformed_table_degrades_gracefully(self):
        import json as _json
        tmp = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bad_floss_tmp.json')
        with open(tmp, 'w', encoding='utf-8') as fh:
            _json.dump({'colours': [{'code': 'X', 'hex': 'not-a-colour'},
                                    {'code': '', 'hex': '#FFFFFF'},
                                    {'code': '900', 'name': 'Ok', 'hex': '#FFFFFF'}]}, fh)
        try:
            self.assertEqual(palette_manager.load_floss_table(tmp), 1,
                             'only the well-formed row should survive')
        finally:
            os.remove(tmp)

    def test_nearest_in_matches_the_original_algorithm(self):
        # _nearest_in was extracted out of nearest_indices so the floss matcher
        # could reuse it. The extraction must not have changed any result.
        palette_manager._ensure_cache()
        rng = np.random.default_rng(1234)
        rgb = rng.integers(0, 256, size=(3000, 3)).astype(float)

        got = palette_manager.nearest_indices(rgb)

        unique_rgb, inverse = np.unique(rgb, axis=0, return_inverse=True)
        lab = palette_manager.rgb_to_lab(unique_rgb)
        best_dist = np.full(lab.shape[0], np.inf)
        best_idx = np.zeros(lab.shape[0], dtype=np.int64)
        for i in range(palette_manager.palette_size()):
            diff = lab - palette_manager._palette_lab[i]
            dist = np.einsum('ij,ij->i', diff, diff)
            mask = dist < best_dist
            best_dist[mask] = dist[mask]
            best_idx[mask] = i
        expected = best_idx[inverse]

        self.assertTrue(np.array_equal(got, expected),
                        'the refactored matcher changed palette results')

    def test_restricted_matching_still_respects_allowed(self):
        palette_manager._ensure_cache()
        rng = np.random.default_rng(99)
        rgb = rng.integers(0, 256, size=(500, 3)).astype(float)
        allowed = [0, 1, 2]
        got = palette_manager.nearest_indices(rgb, allowed=allowed)
        self.assertTrue(np.isin(got, allowed).all())

    def test_generated_palette_js_round_trips_exactly(self):
        # build_site.py injects this into app.bundle.js. If it ever stops
        # matching get_palette(), the static site and the server disagree about
        # colour -- which is exactly the drift this mechanism exists to stop.
        import json as _json
        src = palette_manager.palette_js_source()
        blob = re.search(r'window\.StitchPalette = (.*?);\n', src)
        self.assertIsNotNone(blob, 'palette_js_source must emit window.StitchPalette')
        self.assertEqual(_json.loads(blob.group(1)), palette_manager.get_palette())

        floss = re.search(r'window\.StitchFloss = (.*?);\n', src)
        self.assertIsNotNone(floss)
        meta = _json.loads(floss.group(1))
        self.assertTrue(meta['enabled'])
        self.assertEqual(meta['size'], palette_manager.floss_size())

    def test_static_build_uses_the_generated_palette(self):
        adapter = self._read('static', 'static-adapter.js')
        self.assertIn('window.StitchPalette', adapter,
                      'static-adapter.js must prefer the generated palette')
        build = open(os.path.join(os.path.dirname(os.path.dirname(
            os.path.abspath(__file__))), '.github', 'scripts', 'build_site.py'),
            encoding='utf-8').read()
        self.assertIn('palette_js_source()', build,
                      'build_site.py must inject the generated palette')

    def test_skein_js_defaults_match_config(self):
        import json as _json
        cfg = _json.loads(self._read('config.json'))['skein']
        js = self._read('static', 'skein.js')

        def default_of(name):
            m = re.search(re.escape(name) + r':\s*([0-9.]+)', js)
            self.assertIsNotNone(m, 'skein.js is missing the %s default' % name)
            return float(m.group(1))

        self.assertEqual(default_of('usedStrands'), float(cfg['used_strands']))
        self.assertEqual(default_of('wasteFactor'), float(cfg['waste_factor']))
        self.assertEqual(default_of('stitchesPerSkeinAt14ct'),
                         float(cfg['stitches_per_skein_at_14ct']))

    def test_skein_module_is_bundled_for_the_static_build(self):
        build = open(os.path.join(os.path.dirname(os.path.dirname(
            os.path.abspath(__file__))), '.github', 'scripts', 'build_site.py'),
            encoding='utf-8').read()
        self.assertIn("'skein.js'", build,
                      'skein.js must be in BUNDLE_SCRIPTS or the static build '
                      'ships an editor with no skein estimates')
        self.assertIn('skein.js', self._read('templates', 'index.html'),
                      'index.html must load skein.js so Flask gets it too')

    def test_verification_harnesses_are_not_gitignored(self):
        # tools/ was listed under "IDEs and Editors" in .gitignore, so the
        # harnesses the Pages workflow runs were never committed -- CI would
        # have failed with "Cannot find module tools/verify_render.js".
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(root, '.gitignore'), encoding='utf-8') as fh:
            entries = [ln.strip() for ln in fh]
        self.assertNotIn('tools/', entries)
        self.assertNotIn('tools', entries)

        for name in ('verify_render.js', 'verify_pdf.js'):
            self.assertTrue(os.path.exists(os.path.join(root, 'tools', name)),
                            'tools/%s is required by CI' % name)

        workflow = open(os.path.join(root, '.github', 'workflows', 'pages.yml'),
                        encoding='utf-8').read()
        self.assertIn('tools/verify_render.js', workflow)
        self.assertIn('tools/verify_pdf.js', workflow)


class TestSecurityApp(unittest.TestCase):
    def setUp(self):
        from App.app import app
        app.config['TESTING'] = True
        self.client = app.test_client()

    def test_require_auth_endpoints(self):
        import App.app as app_mod
        # Store original states
        orig_require_auth = app_mod.REQUIRE_AUTH
        orig_allow_auth = app_mod.ALLOW_AUTH
        
        try:
            # Enable auth requirement
            app_mod.REQUIRE_AUTH = True
            app_mod.ALLOW_AUTH = True
            
            # GET /api/projects/abc -> 401
            r = self.client.get('/api/projects/abc')
            self.assertEqual(r.status_code, 401)
            
            # PUT /api/projects/abc -> 401
            r = self.client.put('/api/projects/abc', json={})
            self.assertEqual(r.status_code, 401)
            
            # DELETE /api/projects/abc -> 401
            r = self.client.delete('/api/projects/abc')
            self.assertEqual(r.status_code, 401)
            
        finally:
            app_mod.REQUIRE_AUTH = orig_require_auth
            app_mod.ALLOW_AUTH = orig_allow_auth

class TestToolbarStructure(unittest.TestCase):
    """The toolbar is grouped into labelled clusters and its contextual rows share
    one fixed-height bar. The binding constraint here is that EVERY cached element
    id must still exist in the template: `els` is built from a hard-coded list and
    `bind()` is not defensive, so one missing id stops the page wiring at all."""

    def _read(self, *parts):
        root = os.path.dirname(os.path.abspath(__file__))
        path = os.path.join(root, *parts)
        if not os.path.exists(path):
            path = os.path.join(os.path.dirname(root), *parts)
        with open(path, encoding='utf-8') as fh:
            return fh.read()

    def _cached_ids(self, js):
        start = js.index('function cacheEls() {')
        end = js.index('].forEach(function (id) {', start)
        return re.findall(r'"([A-Za-z_][\w-]*)"', js[start:end])

    def test_every_cached_element_id_exists_in_the_template(self):
        js = self._read('static', 'app.js')
        html = self._read('templates', 'index.html')
        ids = self._cached_ids(js)
        # Sanity: the list really was parsed, or the guard would pass vacuously.
        self.assertGreater(len(ids), 150, 'parsed only %d ids' % len(ids))
        missing = [i for i in ids if ('id="%s"' % i) not in html]
        self.assertEqual(missing, [],
                         'index.html is missing cached ids: %s' % missing)
        self.assertEqual(len(set(ids)), len(ids), 'the id list has duplicates')

    def test_toolbar_is_grouped_into_labelled_clusters(self):
        html = self._read('templates', 'index.html')
        css = self._read('static', 'style.css')
        self.assertIn('id="canvasToolbar"', html)
        self.assertIn('.tool-cluster {', css)
        # [hidden] has to beat the flex display - the repo's recurring trap, and
        # a cluster is exactly the unit the next slice hides per tool.
        self.assertIn('.tool-cluster[hidden] {', css)
        self.assertIn('display: none;', css[css.index('.tool-cluster[hidden] {'):])
        body = html[html.index('id="canvasToolbar"'):html.index('id="optionsBar"')]
        for label in ('Draw', 'Stitch', 'Mark', 'Track', 'Move', 'View'):
            self.assertIn('>%s</span>' % label, body, label)
        # Regrouping must not lose a tool: all ten stay in the toolbar.
        for tool in ('toolPaint', 'toolErase', 'toolFill', 'toolPick', 'toolBack',
                     'toolAnnot', 'toolNote', 'toolProgress', 'toolSelect',
                     'toolOverlay'):
            self.assertIn('id="%s"' % tool, body, tool)
        # The stitch groups are addressable by id, ready to be shown per tool.
        for gid in ('stitchCluster', 'brushGroup', 'stitchPlaceGroup',
                    'stitchDrawGroup'):
            self.assertIn('id="%s"' % gid, body, gid)

    def test_options_bar_reserves_the_height_of_its_tallest_row(self):
        html = self._read('templates', 'index.html')
        css = self._read('static', 'style.css')
        js = self._read('static', 'app.js')
        rows = ('selectOptions', 'progressOptions', 'annotOptions', 'noteOptions',
                'locateOptions', 'overlayOptions')
        for row in rows:
            self.assertIn('id="%s"' % row, html, row)
        # One bar wrapping every row is what makes a reserved height possible.
        bar = html.index('id="optionsBar"')
        for row in rows:
            self.assertGreater(html.index('id="%s"' % row), bar, row)
        self.assertIn('.options-bar[hidden] {', css)
        self.assertIn('min-height: var(--options-bar-h', css)
        # The reserve is only meaningful if no row wraps, and two things keep
        # them to one line. (1) A label input must not be width:100%, which the
        # global input rule sets and which pushed Clear/count/hint onto two more
        # lines (the Annotate row measured 129px before this).
        self.assertIn('width: 220px;', css)
        self.assertIn('flex: 0 1 220px;', css)
        self.assertIn('.annot-text {', css)
        # (2) Static reminder text belongs in a tooltip; only LIVE readouts stay
        # inline. Every remaining .tool-options-hint must therefore carry an id.
        for attrs in re.findall(r'<span class="tool-options-hint"([^>]*)>', html):
            self.assertIn('id=', attrs,
                          'a static hint belongs in a title=, not inline: %s' % attrs)
        # Reserved height is a desktop concern: the one-column layout is
        # deliberately natural-height, so the reserve is lifted there.
        media = css.index('@media (max-width: 1100px)')
        self.assertIn('.options-bar', css[media:],
                      'the narrow layout must lift the reserve')

    def test_options_bar_hides_when_no_row_applies(self):
        js = self._read('static', 'app.js')
        self.assertIn('function syncOptionsBar()', js)
        self.assertIn('syncOptionsBar();', js)
        # Every row must be listed, or the bar would linger with nothing in it
        # (or vanish with a row still visible) whenever a seventh row is added.
        start = js.index('function syncOptionsBar()')
        block = js[start:js.index('els.optionsBar.hidden = !any;', start)]
        for row in ('selectOptions', 'progressOptions', 'annotOptions',
                    'noteOptions', 'locateOptions', 'overlayOptions'):
            self.assertIn('els.%s,' % row, block, row)


    def test_toolbar_icons_are_inline_svg_not_emoji(self):
        html = self._read('templates', 'index.html')
        body = html[html.index('id="canvasToolbar"'):html.index('id="optionsBar"')]
        # Emoji render as a different picture on every platform and cannot take
        # currentColor, so every icon is an inline SVG on the shared stroke weight.
        self.assertGreaterEqual(body.count('class="tool-icon'), 20,
                                'the toolbar icons must all be inline SVG')
        self.assertIn('.tool-icon {', self._read('static', 'style.css'))
        # `solo` marks an icon-only button so it gets no trailing gap.
        self.assertIn('tool-icon solo', body)
        # Stitch shapes are the ONE place a glyph is still meaningful: they label
        # the options of the "Place" dropdown ("Full X", "Half /"), not buttons.
        stripped = re.sub(r'<option\b[^>]*>.*?</option>', '', body, flags=re.S)
        leftovers = re.findall(r'&#\d+;', stripped)
        self.assertEqual(leftovers, [],
                         'glyph entities left in the toolbar: %s' % leftovers)

    def test_view_toggles_live_behind_one_button(self):
        html = self._read('templates', 'index.html')
        js = self._read('static', 'app.js')
        self.assertIn('id="viewBtn"', html)
        self.assertIn('id="viewMenu"', html)
        menu = html[html.index('id="viewMenu"'):html.index('id="overlayGroup"')]
        # The SAME inputs, so everything that reads them keeps working: locate
        # re-targets the spotlight, and the option rows read toggleLocate.checked.
        for toggle in ('toggleGridLines', 'toggleGlyphs', 'toggleCodes',
                       'toggleStitch', 'toggleLocate'):
            self.assertIn('id="%s"' % toggle, menu, toggle)
        # How stitches are DRAWN sits with the other display modes, not beside the
        # "Place" dropdown where the same X and / glyphs meant something else.
        self.assertIn('id="stitchDrawGroup"', menu)
        for style in ('styleCross', 'styleSlash', 'styleBackslash'):
            self.assertIn('id="%s"' % style, menu, style)
        # [hidden] has to beat the panel's own display, as ever.
        self.assertIn('.view-menu[hidden] {', self._read('static', 'style.css'))
        # Escape and outside clicks close it; a click INSIDE must not, so several
        # toggles can be changed in a row.
        self.assertIn('function setViewMenuOpen(', js)
        self.assertIn('setViewMenuOpen(false);', js)
        self.assertIn('document.addEventListener("click"', js)

    def test_only_tools_that_place_stitches_show_stitch_controls(self):
        js = self._read('static', 'app.js')
        self.assertIn('function syncToolContextual(mode)', js)
        self.assertIn('syncToolContextual(mode);', js)
        start = js.index('function syncToolContextual(mode)')
        block = js[start:js.index('function setViewMenuOpen(', start)]
        # Size and Place describe what a click LAYS DOWN, so they follow the tools
        # that place stitches; the cluster goes when both do.
        self.assertIn('els.brushGroup.hidden = !places;', block)
        self.assertIn('els.stitchPlaceGroup.hidden = !parts;', block)
        self.assertIn('els.stitchCluster.hidden = !places && !parts;', block)
        for expr in ('"erase"', '"back"'):
            self.assertIn(expr, block, expr)
        # The Trace cluster is only useful to Align - but it is ALSO the only way
        # to load a photo, and Align stays disabled until one is loaded. Hiding it
        # on "not Align" alone would lock the user out of the feature entirely.
        self.assertIn('var hasPhoto = !!state.overlay;', block)
        self.assertIn('(mode !== "overlay" && hasPhoto)', block)


    def test_toolbar_is_split_into_a_static_and_a_changing_zone(self):
        html = self._read('templates', 'index.html')
        css = self._read('static', 'style.css')
        js = self._read('static', 'app.js')
        static = html[html.index('id="toolbarStatic"'):html.index('id="toolbarRight"')]
        dynamic = html[html.index('id="toolbarDynamic"'):html.index('</div><!-- /tool-right -->')]
        # The five static clusters carry every tool button plus View, and NOTHING
        # that JS can hide - that is the whole point of the split.
        for label in ('Draw', 'Mark', 'Track', 'Move', 'View'):
            self.assertIn('>%s</span>' % label, static, label)
        for tool in ('toolPaint', 'toolErase', 'toolFill', 'toolPick', 'toolBack',
                     'toolAnnot', 'toolNote', 'toolProgress', 'toolSelect',
                     'toolOverlay', 'btnUndo', 'btnRedo', 'zoomOut', 'zoomIn',
                     'zoomFit', 'viewBtn', 'viewMenu'):
            self.assertIn('id="%s"' % tool, static, tool)
        for moving in ('id="stitchCluster"', 'id="overlayGroup"', 'id="brushSize"',
                       'id="stitchPart"'):
            self.assertNotIn(moving, static, 'must live in the changing zone: ' + moving)
            self.assertIn(moving, dynamic, moving)
        # Clear is inside the right-hand block, so it keeps its place whether the
        # settings are showing or not.
        self.assertIn('id="clearBtn"', dynamic)
        self.assertIn('.tool-right {', css)
        self.assertIn('margin-left: auto;', css)
        self.assertIn('.tool-dynamic[hidden]', css)
        self.assertIn('.tool-static[hidden]', css)

    def test_nothing_can_hide_a_static_control(self):
        """The requirement: a tool button must always be where you left it. The
        only way to break that is to hide something in the static zone, so the
        contextual pass is confined to the changing zone by construction."""
        js = self._read('static', 'app.js')
        start = js.index('function syncToolContextual(mode)')
        block = js[start:js.index('function setViewMenuOpen(', start)]
        hidden = re.findall(r'els\.(\w+)\.hidden\s*=', block)
        allowed = {'brushGroup', 'stitchPlaceGroup', 'stitchCluster',
                   'overlayGroup', 'toolbarDynamic'}
        self.assertEqual(set(hidden) - allowed, set(),
                         'syncToolContextual hid something outside the changing '
                         'zone: %s' % sorted(set(hidden) - allowed))
        self.assertEqual(len(hidden), 5, 'expected 5 hiding rules, got %d' % len(hidden))
        # And the static zone is never referenced there at all.
        self.assertNotIn('toolbarStatic', block)
        self.assertNotIn('toolbarRight', block)


    def test_the_progress_readout_is_not_a_row(self):
        html = self._read('templates', 'index.html')
        css = self._read('static', 'style.css')
        js = self._read('static', 'app.js')
        row = html[html.index('id="progressOptions"'):html.index('id="annotOptions"')]
        canvas_info = html.index('id="canvasInfo"')
        # The LIVE readout lives on the status line under the canvas, where it stays
        # visible while painting. It used to be in the row, and the row was kept up
        # whenever tracking was on - which stacked it under the active tool's row
        # and resized the canvas out from under the pointer.
        for live in ('progressPercent', 'progressHint', 'progressStats'):
            self.assertNotIn('id="%s"' % live, row, live)
            self.assertGreater(html.index('id="%s"' % live), canvas_info, live)
        self.assertIn('id="progressGroup"', html)
        self.assertIn('.info-group[hidden] {', css)
        # The row belongs to the Progress tool alone.
        self.assertIn('els.progressOptions.hidden = mode !== "progress";', js)
        self.assertNotIn('mode === "progress" || els.progressOn.checked', js)
        # And the readout steps aside on an empty canvas rather than showing dashes.
        self.assertIn('els.progressGroup.hidden = empty;', js)
        # It must not repeat what the line already says (count, colours, size).
        stats = js[js.index('function progressStatsText(st)'):]
        stats = stats[:stats.index('\n  }')]
        self.assertIn('" left"', stats)
        self.assertNotIn('physicalSizeLabel', stats, 'the info line already has the size')

    def test_every_options_row_fits_one_line(self):
        """A wrapped row DOUBLES the bar's height, and the canvas shrinks with it.
        The Select row was the offender: two Mirror and two Rotate buttons carried
        178px of text between them, which is what pushed it over. They are
        icon-only now, with the meaning in the title and aria-label."""
        html = self._read('templates', 'index.html')
        css = self._read('static', 'style.css')
        sel = html[html.index('id="selectOptions"'):html.index('id="progressOptions"')]
        for btn in ('selMirrorHBtn', 'selMirrorVBtn', 'selRotLBtn', 'selRotRBtn'):
            tag = sel[sel.index('id="%s"' % btn):]
            tag = tag[:tag.index('</button>')]
            self.assertIn('btn-icon', tag, btn)
            self.assertIn('aria-label=', tag, btn)
            self.assertIn('tool-icon', tag, btn)
            self.assertNotIn('>Mirror', tag, btn)
            self.assertNotIn('>Rotate', tag, btn)
        self.assertIn('.btn-icon {', css)
        # Every row therefore fits the reserved height, except Align photo, whose
        # four sliders plus three buttons are two lines at any realistic width.
        self.assertIn('--options-bar-h: 52px;', css)


if __name__ == "__main__":
    unittest.main()
