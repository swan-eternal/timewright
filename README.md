# Timewright

**Create interactive timeline maps of real or fictional worlds.**

Timewright turns YAML files into interactive maps and timelines. Define maps, locations, people, and events, then explore how they relate across time.

You can:

- Build maps of historical periods, fictional worlds, or other settings.
    
- Place locations and events on maps.
    
- Follow characters, armies, ships, and other mobile entities as they move through the world.
    
- Attach notes, descriptions, and biographies to people, places, and events.
    
- Explore the world at different points in time using an interactive timeline.
    

Worlds are stored as plain YAML files. Timewright validates the files and builds a self-contained website that can be viewed locally or published to any static web host.

## Getting Started

### Quick start: Portable release

The easiest way to use Timewright is to download a portable release. No programming experience or separate Node.js installation is required.

1. Visit the [GitHub Releases page](https://github.com/swan-eternal/timewright/releases).
    
2. Download the ZIP for your operating system.
    
3. Extract the ZIP to a folder of your choice.
    
4. Launch Timewright:
    
    - **Windows:** Double-click `Start Timewright.bat`.
        
    - **macOS:** Double-click `Start Timewright.command`. The first time, you may need to right-click the file, select **Open**, and confirm the security prompt.
        
5. Your browser will open the Timewright home page.
    
6. Enter a name, click **Create world**, and then click **Edit** to start building your world.
    

On macOS, choose the correct download for your processor:

- `mac-arm64`: Apple Silicon (M1, M2, M3, and newer).
    
- `mac-x64`: Intel Macs.
    

Timewright runs locally on your computer. Keep the terminal window open while using it, and close it when you are finished. Nothing is installed elsewhere on your system; deleting the extracted folder removes the application.

### Alternative: Windows installation from GitHub

You can also download the repository directly and use its Windows installer.

1. On the [GitHub repository page](https://github.com/swan-eternal/timewright), click **Code → Download ZIP**.
    
2. Extract the downloaded ZIP.
    
3. Open the extracted folder and double-click `install.bat`.
    
4. If Node.js is not installed, the installer will open the Node.js download page. Install Node.js and run `install.bat`again.
    
5. When installation finishes, your browser will open the Timewright home page.
    

To start Timewright again, double-click `start.bat` in the extracted folder. Keep the command window open while using the application.

### Installation from source

For developers who want to work with the source code:

```
git clone https://github.com/swan-eternal/timewright
cd timewright
npm install
npm run build
node dist/cli/index.js home
```

Requires Node.js 22 or newer.

**Note:** Installing directly from GitHub using `npm install -g github:...` is not currently supported. The build process requires tools that are not available when npm installs directly from a repository. Clone the repository and build it locally instead.

## Creating a World

A Timewright world is a folder containing YAML files, map images, and other resources.

For example:

```
my-world/
├── world.yaml
├── maps/
│   ├── europe.yaml
│   └── europe-1800.jpg
├── people/
│   └── napoleon.yaml
├── locations/
└── events/
```

The files define the contents of the world:

|File or folder|Contents|
|---|---|
|`world.yaml`|World title, calendar, and default map|
|`maps/`|Map definitions and map images|
|`people/`|Character and person records|
|`locations/`|Locations and their map coordinates|
|`events/`|Historical or fictional events|

A simple event might look like this:

```
- title: Battle of Waterloo
  when: 1815-06-18
  where: Waterloo
  people: [Napoleon]
  card: |
    The last battle of the Napoleonic Wars.
```

Dates can be as simple or as detailed as your world requires. Timewright supports:

- Years: `1815`
    
- Months: `1815-06`
    
- Approximate dates: `~1200`
    
- Date ranges: `1805..1807`
    
- Open-ended dates: `<2300`
    
- Custom calendars with named months and eras.
    

If a date appears to be invalid, Timewright issues a warning rather than rejecting the world. Worlds without dates can also use chapter-based ordering for their events.

For the complete YAML reference, see [docs/FORMAT.md](docs/FORMAT.md).

If you want to use an AI coding agent to help create a world, see [docs/AGENT_GUIDE.md](docs/AGENT_GUIDE.md). It provides a concise guide to the world format and is designed to be used as a reference when generating YAML files.

## Editing a World

Timewright includes a browser-based editor called **Studio**. It lets you create and modify a world without editing YAML files directly.

To open the editor, run:

```
timewright edit --world ~/my-world
```

You can also use the included launcher scripts:

```
./start-studio.sh                 # Use the world in this folder, or the example
./start-studio.sh ~/my-world      # Open a specific world
```

On Windows, use `start-studio.cmd`.

The launcher builds Timewright if necessary, starts the editor, and opens it in your browser.

### Studio features

The editor provides a map-based workspace with tabs for Maps, People, Locations, Events, and World.

You can:

- Click the map to create a location or event.
    
- Drag existing markers to change their positions.
    
- Edit names, dates, tags, descriptions, and other properties.
    
- Upload replacement map images.
    
- Delete records.
    
- Rename records while automatically updating references to them.
    

The editor writes changes directly to the world's YAML files, preserving existing comments. YAML remains the source of truth, so files can still be edited by hand or modified by external tools.

Records created by Studio receive permanent IDs. These IDs allow Timewright to maintain references when records are renamed.

### Working with the timeline

Studio displays the world at a selected point in time. A timeline beneath the map lets you navigate between dates and events.

You can:

- Enter a date directly.
    
- Step through events using Previous and Next.
    
- Drag the timeline playhead.
    
- Select individual events from the timeline.
    
- Switch between **At Date** and **All Time** views.
    

The editor also accounts for changes in the world over time:

- Maps change automatically when different maps are defined for different periods.
    
- Mobile locations, such as ships and armies, appear at their recorded positions on the selected date.
    
- People aboard mobile locations appear at those locations as well.
    
- Locations that have not yet existed at the selected date are dimmed.
    
- Saving an event automatically moves the editor's timeline to that event's date.
    

When creating a location or event, Studio uses the currently selected map, map position, and date to prepopulate the new record.

Events also provide selectable character references, avoiding misspelled names. Location records show how many events are associated with them and provide access to those events.

## Placing Locations on Maps

Locations need map coordinates to appear in the viewer. You can define a location without coordinates initially:

```
- name: Waterloo
  map: europe
```

Run:

```
timewright validate
```

Timewright will report locations that still need to be placed.

Then run:

```
timewright pick
```

This opens a local map-placement tool. Select a location and click its position on the map to assign coordinates. The tool writes the coordinates back into the YAML file while preserving comments and other existing content.

The placement tool runs locally and is not included in the published website.

## Viewing and Publishing a World

Timewright builds worlds into static websites. The generated files can be hosted on GitHub Pages or any other static web host. No database or application server is required.

### Previewing a world

Use the development viewer to run a world locally:

```
timewright dev
```

The development viewer reloads when the world files change.

### Building a static website

To build a world:

```
timewright build --world . --out dist
```

The output folder contains the complete website. Upload its contents to your web host to publish the world.

### Creating a single-file version

You can also package a world into one self-contained HTML file:

```
timewright build --world . --out dist --single-file
```

This produces:

```
dist/world.html
```

The file includes the world data, viewer, and map images. It can be shared by email, copied to removable media, or opened without hosting a website.

### Publishing with GitHub Pages

A template workflow is available in `templates/github-pages`.

To publish a world:

1. Create a separate GitHub repository for your world.
    
2. Place the world files in the root of the repository.
    
3. Add the GitHub Pages workflow from `templates/github-pages`.
    
4. Push your changes.
    

The workflow builds the website and publishes it to GitHub Pages. It installs Timewright directly from GitHub, so there is no need to publish the package to npm.

Timewright uses relative URLs, so published sites work under GitHub Pages repository paths such as `/my-world/`without additional configuration.

## Command Reference

Timewright provides a command-line interface for creating, editing, validating, and building worlds.

|Command|Description|
|---|---|
|`timewright init [folder]`|Create a starter world.|
|`timewright validate`|Check a world for errors and warnings.|
|`timewright build`|Build a world into a static website.|
|`timewright dev`|Run the local viewer with automatic reloading.|
|`timewright pick`|Assign map coordinates to locations.|
|`timewright edit`|Open the browser-based Studio editor.|
|`timewright schema`|Print the JSON Schema for the world format.|

Useful options:

|Option|Description|
|---|---|
|`--json`|Output machine-readable validation results, for agents.|
|`--strict`|Treat warnings as errors.|
|`--base`|Accepted for older versions; the site URLs are relative now, so they serve from any path.|
|`--single-file`|Also write one self-contained HTML file.|
