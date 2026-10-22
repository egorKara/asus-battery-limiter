"""Offline tests: all simulated battery writes stay inside temporary directories."""
import importlib.machinery
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / "battery-limiter"
LOADER = importlib.machinery.SourceFileLoader("battery_limiter", str(SOURCE))
SPEC = importlib.util.spec_from_loader(LOADER.name, LOADER)
bl = importlib.util.module_from_spec(SPEC)
LOADER.exec_module(bl)


def info(full=48028000, design=44460000):
    return {"manufacturer": "ASUSTeK", "model": "ASUS Battery",
            "technology": "Li-ion", "full": full, "design": design, "cycles": 36}


class PolicyTests(unittest.TestCase):
    def test_current_battery_invalid_over_design_does_not_influence_policy(self):
        self.assertEqual(bl.profile(info(), 0), (50, 60, None))

    def test_cycle_offsets_are_bounded_and_repeat(self):
        self.assertEqual([(bl.profile(info(), n)[:2]) for n in range(4)],
                         [(50, 60), (49, 59), (48, 58), (50, 60)])

    def test_worn_battery_uses_conservative_window(self):
        lo, hi, health = bl.profile(info(30000000, 44000000), 0)
        self.assertEqual((lo, hi), (48, 59))
        self.assertLess(health, .8)

    def test_unknown_vendor_rejected(self):
        other = info()
        other["manufacturer"] = "Unknown"
        with self.assertRaises(ValueError):
            bl.profile(other, 0)

    def test_hold_then_start_then_continue_until_max(self):
        start, threshold, messages = bl.decide("life", 73, info(), {})
        self.assertEqual((threshold, start["phase"], messages), (50, "hold", []))
        charging, threshold, messages = bl.decide("life", 49, info(), start)
        self.assertEqual((threshold, charging["phase"]), (60, "charging"))
        self.assertEqual(len(messages), 1)
        continued, threshold, messages = bl.decide("life", 53, info(), charging)
        self.assertEqual((threshold, messages), (60, []))
        held, threshold, messages = bl.decide("life", 60, info(), continued)
        self.assertEqual((threshold, held["cycle"], held["phase"]), (49, 1, "hold"))
        self.assertEqual(len(messages), 1)
        held_again, threshold, messages = bl.decide("life", 60, info(), held)
        self.assertEqual((threshold, messages), (49, []))

    def test_full_mode(self):
        _, threshold, _ = bl.decide("full", 73, info(), {})
        self.assertEqual(threshold, 100)

    def test_off_mode_is_unavailable_without_real_switch(self):
        with patch.object(bl, "off_supported", return_value=False):
            with self.assertRaisesRegex(RuntimeError, "не поддерживается"):
                bl.decide("off", 50, info(), {})

    def test_migration(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "config.json"
            for old, expected in ((75, "life"), (100, "full")):
                path.write_text(json.dumps({"threshold": old}))
                self.assertEqual(bl.get_mode(path), expected)

    def test_physical_step_simulation_and_events(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            for name, value in {
                "manufacturer": "ASUSTeK", "model_name": "ASUS Battery",
                "technology": "Li-ion", "energy_full": "48028000",
                "energy_full_design": "44460000", "capacity": "73",
                "status": "Not charging", "charge_control_end_threshold": "75",
            }.items():
                (root / name).write_text(value)
            config = root / "config.json"
            config.write_text('{"mode":"life"}')
            with patch.object(bl, "BATTERY", root):
                held = bl.step(config, {})
                self.assertEqual((root / "charge_control_end_threshold").read_text(), "50")
                (root / "capacity").write_text("49")
                charging = bl.step(config, held)
                self.assertEqual((root / "charge_control_end_threshold").read_text(), "60")
                self.assertEqual(charging["event_id"], 1)
                (root / "status").write_text("Charging")
                actually_charging = bl.step(config, charging)
                self.assertEqual(actually_charging["event_id"], 2)
                again = bl.step(config, actually_charging)
                self.assertEqual(again["event_id"], 2)
                (root / "status").write_text("Not charging")
                (root / "capacity").write_text("60")
                finished = bl.step(config, again)
                self.assertEqual((root / "charge_control_end_threshold").read_text(), "49")
                self.assertEqual(finished["cycle"], 1)
                self.assertEqual(finished["event_id"], 3)
                config.write_text('{"mode":"off"}')
                with self.assertRaises(RuntimeError):
                    bl.step(config, finished)
                self.assertEqual((root / "charge_control_end_threshold").read_text(), "49")

    def test_corrupt_state_never_controls_device(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "settings"
            path.write_text('{"mode":"unknown"}')
            with self.assertRaises(ValueError):
                bl.get_mode(path)

    def test_real_disable_interface_in_fake_sysfs(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            values = {"manufacturer": "ASUSTeK", "model_name": "ASUS Battery",
                      "technology": "Li-ion", "capacity": "73", "status": "Not charging",
                      "charging_enabled": "1", "charge_control_end_threshold": "75"}
            for name, value in values.items():
                (root / name).write_text(value)
            config = root / "config.json"
            config.write_text('{"mode":"off"}')
            with patch.object(bl, "BATTERY", root):
                stopped = bl.step(config, {})
                self.assertEqual((root / "charging_enabled").read_text(), "0")
                self.assertEqual(stopped["phase"], "off")
                config.write_text('{"mode":"full"}')
                bl.step(config, stopped)
                self.assertEqual((root / "charging_enabled").read_text(), "1")
                self.assertEqual((root / "charge_control_end_threshold").read_text(), "100")

    def test_install_preserves_existing_files_with_root_ownership_simulated(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            home = root / "home"
            (home / "bin").mkdir(parents=True)
            (home / ".config").mkdir()
            (root / "etc").mkdir()
            old_binary = home / "bin/battery-limiter"
            old_binary.write_text("old program")
            (home / ".config/battery-limiter.json").write_text('{"threshold":75}')
            unit = root / "etc/battery-limiter.service"
            unit.write_text("old service")
            with (patch.object(bl, "SERVICE", unit),
                  patch.object(bl, "INSTALLED", root / "libexec/battery-limiter"),
                  patch.object(bl.os, "geteuid", return_value=0),
                  patch.object(bl.os, "chown"),
                  patch.object(bl, "live_state", return_value={
                      "timestamp": float("inf"), "mode": "life", "min": 50,
                      "max": 60, "phase": "hold", "error": None}) as mock_state,
                  patch.object(bl, "number", return_value=50),
                  patch.object(bl.pwd, "getpwnam", return_value=SimpleNamespace(
                      pw_dir=str(home), pw_uid=1000, pw_gid=1000)),
                  patch.object(bl.subprocess, "run")):
                bl.install("oem")
                mock_state.return_value["error"] = "hardware rejected"
                with self.assertRaisesRegex(RuntimeError, "hardware rejected"):
                    bl.install("oem")
                self.assertEqual(unit.read_text(), "old service")
            self.assertEqual((home / "bin/battery-limiter.v1.bak").read_text(), "old program")
            self.assertEqual((root / "etc/battery-limiter.service.v1.bak").read_text(), "old service")
            self.assertTrue(old_binary.read_text().startswith("#!/usr/bin/python3"))

    def test_tray_names_hints_and_vector_animation(self):
        import xml.etree.ElementTree as ET
        self.assertEqual(list(bl.MODE_NAMES.values()),
                         ["Полный заряд", "Ресурс батареи", "Без зарядки"])
        self.assertEqual([len(bl.ICON_FRAMES[k]) for k in ("full", "life", "off")],
                         [7, 4, 1])
        self.assertEqual(bl.ICON_FRAMES["full"],
                         ("○○○", "●○○", "○●○", "○○●", "●○●", "○●●", "●●●"))
        self.assertEqual(bl.ICON_FRAMES["life"],
                         ("○●○", "○○●", "○●○", "●○○"))
        self.assertEqual(bl.ICON_FRAMES["off"], ("○○○",))
        self.assertIn("50–60%", bl.mode_hint("life", {"min": 50, "max": 60}))
        self.assertIn("100%", bl.mode_hint("full", {}))
        with patch.object(bl, "off_supported", return_value=False):
            self.assertIn("Недоступно", bl.mode_hint("off", {}))
        with tempfile.TemporaryDirectory() as d:
            icons = Path(d)
            bl.ensure_frame_icons(icons)
            self.assertEqual(len(list(icons.glob("*.svg"))), 7)
            for mode_frames in bl.ICON_FRAMES.values():
                for frame in mode_frames:
                    self.assertEqual(len(frame), 3)
                    self.assertTrue(set(frame) <= {"○", "●"})
                    icon = icons / (bl.frame_icon_name(frame) + ".svg")
                    root = ET.parse(icon).getroot()
                    self.assertEqual(len(root), 3)
                    self.assertTrue(icon.name.endswith("-symbolic.svg"))
                    self.assertEqual(
                        "".join("●" if dot.attrib["fill"] == "#bebebe" else "○"
                                for dot in root), frame)
                    self.assertTrue(all(dot.attrib["stroke-width"] == "0.75"
                                        and dot.attrib["stroke"] == "#bebebe"
                                        for dot in root))


if __name__ == "__main__":
    unittest.main()
