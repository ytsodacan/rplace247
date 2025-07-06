from __future__ import annotations

import argparse
import datetime
import json
import sys
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, simpledialog
from typing import TYPE_CHECKING, Any, Dict, List, Tuple

try:
    from PIL import Image as PILImage
    try:
        Resampling = PILImage.Resampling
    except AttributeError:
        Resampling = PILImage
    if TYPE_CHECKING:
        from PIL.Image import Image as ImageType
    else:
        ImageType = PILImage.Image
except ImportError:
    PILImage = None
    ImageType = Any
    Resampling = None

try:
    from tqdm import tqdm
except ImportError:
    tqdm = None


def rgb_to_hex(rgb: Tuple[int, int, int]) -> str:
    """Converts an RGB tuple to a hexadecimal color string."""
    r, g, b = (max(0, min(255, int(c))) for c in rgb)
    return f"#{r:02X}{g:02X}{b:02X}"


def image_to_grid_json(image_path: Path,
                       output_json_path: Path,
                       target_width: int,
                       target_height: int,
                       show_gui_messages: bool = False,
                       cli_mode: bool = False) -> None:
    """
    Converts an image into a grid of hexadecimal color codes and saves it as a JSON file.
    """
    if not PILImage:
        raise ImportError(
            "Pillow library is required. Please install it using: pip install Pillow"
        )

    try:
        img: ImageType = PILImage.open(image_path)

        resample_filter: Any = Resampling.LANCZOS if Resampling else PILImage.LANCZOS
        img = img.resize((target_width, target_height), resample_filter)
        img = img.convert("RGB")

        pixels = img.load()
        if pixels is None:
            raise RuntimeError("Failed to load image pixels.")

        y_range = range(img.height)
        if cli_mode and tqdm:
            y_range = tqdm(y_range,
                           desc="Processing Rows",
                           unit="row",
                           ncols=80)

        grid_data = [[rgb_to_hex(pixels[x, y]) for x in range(img.width)]
                     for y in y_range]

        json_output: Dict[str, Any] = {
            "timestamp":
            datetime.datetime.now(
                datetime.timezone.utc).isoformat(timespec='milliseconds'),
            "version":
            "1.1",
            "gridWidth":
            target_width,
            "gridHeight":
            target_height,
            "data":
            grid_data,
        }

        output_json_path.parent.mkdir(parents=True, exist_ok=True)
        with output_json_path.open('w') as f:
            json.dump(json_output, f, indent=2)

        success_message = f"Successfully converted '{image_path.name}' to '{output_json_path.name}'"
        print(success_message)
        if show_gui_messages:
            messagebox.showinfo("Success", success_message)

    except FileNotFoundError:
        error_message = f"Image file not found at '{image_path}'"
        print(f"Error: {error_message}", file=sys.stderr)
        if show_gui_messages:
            messagebox.showerror("Error", error_message)
        raise
    except Exception as e:
        error_message = f"An unexpected error occurred: {e}"
        print(f"Error: {error_message}", file=sys.stderr)
        if show_gui_messages:
            messagebox.showerror("Error", error_message)
        raise


def run_gui():
    """Initializes Tkinter and runs the file selection and configuration GUI."""
    root = tk.Tk()
    root.withdraw()

    image_path_str = filedialog.askopenfilename(
        title="Select an Image File",
        filetypes=[("Image Files", "*.png *.jpg *.jpeg *.bmp *.gif"),
                   ("All Files", "*.*")])
    if not image_path_str:
        print("No image file selected. Exiting.")
        return

    width = simpledialog.askinteger("Grid Dimensions",
                                    "Enter the desired width:",
                                    initialvalue=500,
                                    minvalue=1,
                                    parent=root)
    if width is None:
        print("Width entry cancelled. Exiting.")
        return

    height = simpledialog.askinteger("Grid Dimensions",
                                     "Enter the desired height:",
                                     initialvalue=500,
                                     minvalue=1,
                                     parent=root)
    if height is None:
        print("Height entry cancelled. Exiting.")
        return

    input_p = Path(image_path_str)
    output_path_str = filedialog.asksaveasfilename(
        title="Save Grid JSON As",
        filetypes=[("JSON Files", "*.json")],
        defaultextension=".json",
        initialdir=str(input_p.parent),
        initialfile=f"{input_p.stem}_grid.json")
    if not output_path_str:
        print("No output file selected. Exiting.")
        return

    try:
        image_to_grid_json(Path(image_path_str),
                           Path(output_path_str),
                           target_width=width,
                           target_height=height,
                           show_gui_messages=True)
    except Exception:
        pass
    finally:
        root.destroy()


def run_cli():
    """Parses command-line arguments and runs the conversion."""
    parser = argparse.ArgumentParser(
        description=
        "Convert an image to a grid of hex color values in a JSON file.",
        epilog=
        "If no arguments are provided, the script will launch a graphical interface."
    )
    parser.add_argument("image_path",
                        type=Path,
                        help="Path to the input image file.")
    parser.add_argument(
        "-o",
        "--output",
        dest="output_json",
        type=Path,
        help="Output JSON file path. Defaults to '<image_name>_grid.json'.")
    parser.add_argument("-w",
                        "--width",
                        type=int,
                        default=500,
                        help="Target width of the grid (default: 500).")
    parser.add_argument("-H",
                        "--height",
                        type=int,
                        default=500,
                        help="Target height of the grid (default: 500).")
    args = parser.parse_args()

    if not args.image_path.is_file():
        print(f"Error: Image file not found at '{args.image_path}'",
              file=sys.stderr)
        sys.exit(1)

    output_path = args.output_json or args.image_path.with_name(
        f"{args.image_path.stem}_grid.json")

    try:
        image_to_grid_json(args.image_path,
                           output_path,
                           target_width=args.width,
                           target_height=args.height,
                           cli_mode=True)
    except Exception:
        sys.exit(1)


def main():
    """Main entry point. Decides whether to run in GUI or CLI mode."""
    if PILImage is None:
        message = "Required library not found. Please install it using: pip install Pillow"
        print(message, file=sys.stderr)
        try:
            root = tk.Tk()
            root.withdraw()
            messagebox.showerror("Dependency Error", message)
            root.destroy()
        except tk.TclError:
            pass
        sys.exit(1)

    if len(sys.argv) > 1:
        run_cli()
    else:
        try:
            run_gui()
        except (tk.TclError, ImportError):
            print(
                "GUI could not be launched. This might be because you are in an environment without a display.",
                file=sys.stderr)
            print("Please run with command-line arguments. Use '-h' for help.",
                  file=sys.stderr)
            sys.exit(1)


if __name__ == "__main__":
    main()
