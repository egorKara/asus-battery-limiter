# ASUS Battery Limiter

Утилита для ограничения заряда батареи на ноутбуках ASUS (и других с поддержкой `charge_control_end_threshold`).

Продлевает срок службы Li-ion батареи, не давая ей заряжаться выше заданного порога.

## Возможности

- **CLI** — быстрая установка и проверка порога
- **Tray** — иконка в трее с меню выбора порога (Cinnamon/MATE/Xfce)
- **Systemd** — восстановление порога после перезагрузки

## Допустимые значения

60, 65, 70, 75, 80, 85, 90, 95, 100 (шаг 5%)

## Использование

```bash
# Установить порог 65%
battery-limiter set 65

# Посмотреть статус
battery-limiter status

# Запустить трей-иконку
battery-limiter --tray

# Установить systemd-службу автовосстановления
battery-limiter install

# Удалить systemd-службу
battery-limiter uninstall
```

## Требования

- Linux с `/sys/class/power_supply/BAT0/charge_control_end_threshold`
- Python 3 + `python3-gi` + `gir1.2-appindicator3-0.1` (для трея)
- systemd (для службы автовосстановления)

## Совместимость

Проверено на **ASUS UX310U** (Mint 22.1, Cinnamon). Должно работать на Lenovo, Dell, HP — любых ноутбуках с поддержкой `charge_control_end_threshold` в sysfs.

## Лицензия

MIT
