# STEM Smart Labs // Web Bluetooth Micro:bit Controller

STEM Smart Labs is a premium, static, responsive Progressive Web App (PWA) designed to control DIY robots powered by the **BBC micro:bit** or **Calliope mini** via Bluetooth Low Energy (BLE). It serves as a modern open-source alternative to the LOFI Control app, built entirely with zero build dependencies (vanilla HTML5, CSS3, and ES6 Javascript) so it can be served statically on any host, including **GitHub Pages**.

## Key Features

- **Web Bluetooth Connectivity**: Connects directly to the micro:bit's Nordic UART Service (NUS) from any compatible browser (Chrome, Edge, Opera, or Bluefy on iOS).
- **Multiple Input Layouts**:
  - **D-Pad Mode**: Digital directional buttons with keyboard bindings (`WASD` or `Arrows`).
  - **Analog Joystick**: Canvas-based touch-draggable joystick that outputs smooth polar/Cartesian coords.
  - **Mixer Mode**: Action triggers (A, B, C, D) and continuous servo angle sliders (0°-180°).
  - **Tilt Control**: Device Orientation API integration allowing accelerometer-based tilt control.
- **Console Terminal**: Live logging of outgoing and incoming packets to facilitate easy debugging on the micro:bit side.
- **Throttled BLE Writes**: Throttles continuous coordinate writes to 20Hz (every 50ms) to prevent UART buffer overflow on the micro:bit.
- **Responsive Theme**: Premium, responsive glassmorphism aesthetic tailored for landscape/portrait gaming on mobile phones, tablets, or laptops.

## How to Test Locally

1. Open your terminal in this workspace.
2. Spin up a local development server. You can use Python, Node.js, or any other server:

   **Using Python:**
   ```bash
   python -m http.server 8000
   ```

   **Using Node (http-server):**
   ```bash
   npx http-server -p 8000
   ```

3. Open Chrome or Edge and navigate to `http://localhost:8000`.
4. *Note:* Web Bluetooth requires a secure context (HTTPS), but `localhost` (and `127.0.0.1`) is treated as a secure origin by default, enabling full testing locally.

## Deploying to GitHub Pages

Since the app consists of static files only, deploying to GitHub Pages is extremely straightforward:

1. Create a repository on GitHub (e.g. `stem-smart-controller`).
2. Initialize git and commit your files in this directory:
   ```bash
   git init
   git add .
   git commit -m "Initial commit of STEM Smart Labs App"
   ```
3. Push to your GitHub repository:
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/stem-smart-controller.git
   git branch -M main
   git push -u origin main
   ```
4. On GitHub, go to your repository **Settings** -> **Pages** tab.
5. Under **Build and deployment**, select **Deploy from a branch**.
6. Set the branch to `main` (or the branch you pushed to) and the folder to `/ (root)`. Click **Save**.
7. In a few minutes, your site will be live at `https://YOUR_USERNAME.github.io/stem-smart-controller/`.

## Data Communication Protocol (Web App -> Micro:bit)

The web app transmits UTF-8 encoded text commands terminated by a newline character (`\n`) via the Nordic UART Rx characteristic.

| Command Format | Mode | Description | Example |
| :--- | :--- | :--- | :--- |
| `UP\n` | D-Pad / Emulated | Press Forward | `UP\n` |
| `DOWN\n` | D-Pad / Emulated | Press Backward | `DOWN\n` |
| `LEFT\n` | D-Pad / Emulated | Press Left | `LEFT\n` |
| `RIGHT\n` | D-Pad / Emulated | Press Right | `RIGHT\n` |
| `up\n`, `down\n`, `left\n`, `right\n` | D-Pad / Emulated | Release Direction (Stop) | `up\n` |
| `X+xx,Y+yy\n` | Joystick / Tilt | Signed, 2-digit padded coordinates (clamped `-90` to `90`) | `X+00,Y-45\n` |
| `A\n`, `B\n`, `C\n`, `D\n` | Mixer | Button Pressed | `A\n` |
| `a\n`, `b\n`, `c\n`, `d\n` | Mixer | Button Released | `a\n` |
| `cVal\n` | Mixer | Slider 1 angle (`0` to `180`), padded to 3 digits | `c090\n` |
| `xVal\n` | Mixer | Slider 2 angle (`0` to `180`), padded to 3 digits | `x180\n` |
| `mode_dpad\n` | Mode Switch | Switched to D-Pad mode | `mode_dpad\n` |
| `mode_analog\n` | Mode Switch | Switched to Joystick mode | `mode_analog\n` |
| `mode_accelerometer\n` | Mode Switch | Switched to Tilt mode | `mode_accelerometer\n` |
| `mode_mixed\n` | Mode Switch | Switched to Mixer mode | `mode_mixed\n` |

## Micro:bit V2 MicroPython Template

This template can be flashed to your micro:bit V2 to receive and process D-Pad, Joystick/Tilt, action buttons, or Slider/Servo values:

```python
from microbit import *
import bluetooth

# Setup Bluetooth UART service
uart = bluetooth.Uart()
uart.start()

display.show(Image.ASLEEP)

while True:
    if uart.is_connected():
        display.show(Image.YES)
        if uart.any():
            data = uart.readline().decode('utf-8').strip()
            
            # 1. Parse D-Pad Commands (or Emulated direction changes)
            if data == "UP":
                # Drive motors forward
                pass
            elif data == "DOWN":
                # Drive motors backward
                pass
            elif data == "LEFT":
                # Turn Left
                pass
            elif data == "RIGHT":
                # Turn Right
                pass
            elif data in ["up", "down", "left", "right"]:
                # Stop motors
                pass
                
            # 2. Action Buttons
            elif data == "A":
                # Button A pressed
                pass
            elif data == "a":
                # Button A released
                pass
            
            # 3. Sliders / Servos
            elif data.startswith("c"):
                try:
                    servo_val = int(data[1:])
                    # Set Servo 1 to servo_val (0-180)
                except:
                    pass
            elif data.startswith("x"):
                try:
                    servo_val = int(data[1:])
                    # Set Servo 2 to servo_val (0-180)
                except:
                    pass

            # 4. Parse Joystick/Tilt Commands
            elif data.startswith("X") and ",Y" in data:
                try:
                    parts = data.split(',')
                    joyX = int(parts[0][1:])
                    joyY = int(parts[1][2:])
                    # Translate joyX and joyY (-90 to 90) to motor speeds
                except:
                    pass
    else:
        display.show(Image.NO)
        sleep(200)
```
