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

if __name__ == "__main__":
    unittest.main()
