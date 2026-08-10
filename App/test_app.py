import unittest
import numpy as np
from App import palette_manager, image_manager

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

if __name__ == "__main__":
    unittest.main()
