"use strict";
function dist(point1, point2) {
    return Math.sqrt(Math.pow(point1.x - point2.x, 2) + Math.pow(point1.y - point2.y, 2));
}
function angle(point1, point2, origin) {
    const vector1 = { x: point1.x - origin.x, y: point1.y - origin.y };
    const vector2 = { x: point2.x - origin.x, y: point2.y - origin.y };
    return Math.acos((vector1.x * vector2.x + vector1.y * vector2.y) / dist(point1, origin) / dist(point2, origin));
}
class Settings {
    constructor() {
        this.frequency_range = { low: 65, high: 20000 };
        this.rate = 5;
        this.box = { x: 100, y: 100, width: 500, height: 500 };
        this.origin = { x: 350, y: 350 };
        this.anchor_size = 5;
        this.origin_size = 5;
        this.fill = "white";
        this.shape_fill = "#ececec";
        this.stroke = "#0349fc";
        this.grid_stroke = "#ADD8E6";
        this.stroke_thickness = 1;
    }
}
class Point {
    constructor(angle, radius, origin_x, origin_y) {
        this._angle = angle;
        this._radius = radius;
        this._origin_x = origin_x;
        this._origin_y = origin_y;
    }
    get angle() {
        return this._angle;
    }
    get radius() {
        return this._radius;
    }
    get x() {
        return Math.cos(this._angle) * this._radius + this._origin_x;
    }
    get y() {
        return Math.sin(this._angle) * this._radius + this._origin_y;
    }
    get origin_x() {
        return this._origin_x;
    }
    get origin_y() {
        return this._origin_y;
    }
    static from_polar(angle, radius, origin_x, origin_y) {
        return new Point(angle, radius, origin_x, origin_y);
    }
    static from_cartesian(x, y, origin_x, origin_y) {
        const angle = (Math.atan2(y - origin_y, x - origin_x) + 2 * Math.PI) % (2 * Math.PI);
        return new Point(angle, dist({ x: x, y: y }, { x: origin_x, y: origin_y }), origin_x, origin_y);
    }
}
class Polygon {
    constructor() {
        this._points = [];
    }
    get points() {
        return this._points;
    }
    check_bounds(index) {
        if (index < 0 || index >= this._points.length) {
            throw new Error("Index out of bounds");
        }
    }
    line_equation(point1, point2) {
        const a = (-point1.y + point2.y);
        const b = (point1.x - point2.x);
        const c = -a * point1.x - b * point1.y;
        return { a: a, b: b, c: c };
    }
    find_insert_index(point) {
        for (let index = 0; index < this._points.length; index++) {
            if (point.angle < this._points[index].angle) {
                return index;
            }
        }
        return this._points.length;
    }
    find_weighted_intersections(line) {
        const intersections = [];
        for (let index = 0; index < this._points.length; index++) {
            const point1 = this._points[index];
            const point2 = this._points[(index + 1) % this._points.length];
            const line_equation = this.line_equation(point1, point2);
            const left_bound = Math.min(point1.x, point2.x);
            const right_bound = Math.max(point1.x, point2.x);
            const intersection_x = (line.b * line_equation.c - line_equation.b * line.c) / (line.a * line_equation.b - line_equation.a * line.b);
            const intersection_y = (line.a * line_equation.c - line_equation.a * line.c) / (line_equation.a * line.b - line.a * line_equation.b);
            const segment_angle = Math.atan2(-line_equation.a, line_equation.b);
            if (intersection_x >= left_bound && intersection_x <= right_bound && isFinite(intersection_x) && isFinite(intersection_y)) {
                intersections.push({ point: { x: intersection_x, y: intersection_y }, x_axis_angle: segment_angle });
            }
        }
        return intersections;
    }
    find_intersections(line) {
        const intersections = this.find_weighted_intersections(line);
        const projection = Array(intersections.length);
        intersections.forEach((intersection, index) => {
            projection[index] = intersection.point;
        });
        return projection;
    }
    is_inside(point, rule) {
        switch (rule) {
            case "evenodd":
                const intersections = this.find_intersections({ a: 1, b: 0, c: -point.x });
                let count = 0;
                for (let index = 0; index < intersections.length; index++) {
                    if (intersections[index].y < point.y) {
                        count++;
                    }
                }
                return count % 2 != 0;
            case "nonzero":
                const weighted_intersections = this.find_weighted_intersections({ a: 0, b: 1, c: -point.y });
                let winding_number = 0;
                for (let index = 0; index < weighted_intersections.length; index++) {
                    const intersection = weighted_intersections[index];
                    if (intersection.point.x >= point.x) {
                        winding_number += intersection.x_axis_angle > 0 ? 1 : -1;
                    }
                }
                return winding_number != 0;
            default:
                throw new Error("Not implemented");
        }
    }
    lies_on_side(point) {
        const epsilon = 1e-6;
        for (let index = 0; index < this._points.length; index++) {
            const point1 = this._points[index];
            const point2 = this._points[(index + 1) % this._points.length];
            const left_bound = Math.min(point1.x, point2.x);
            const right_bound = Math.max(point1.x, point2.x);
            const line_equation = this.line_equation(point1, point2);
            if (Math.abs(line_equation.a * point.x + line_equation.b * point.y + line_equation.c) < epsilon && point.x >= left_bound && point.x <= right_bound) {
                return true;
            }
        }
        return false;
    }
    insert(point) {
        this._points.splice(this.find_insert_index(point), 0, point);
    }
    delete(index) {
        this.check_bounds(index);
        this._points.splice(index, 1);
    }
    replace(index, value) {
        this.check_bounds(index);
        this._points[index] = value;
    }
}
class Grid {
    constructor(partition, director) {
        this._partition = partition;
        this._director = director;
    }
    limit_coords_within_box(position) {
        const x = Math.min(Math.max(position.x, this._director.settings.box.x), this._director.settings.box.x + this._director.settings.box.width);
        const y = Math.min(Math.max(position.y, this._director.settings.box.y), this._director.settings.box.y + this._director.settings.box.height);
        return Point.from_cartesian(x, y, position.origin_x, position.origin_y);
    }
    snap_to_grid(point) {
        const box = this._director.settings.box;
        const limited = this.limit_coords_within_box(point);
        const size = this.size;
        const x_factor = Math.round((limited.x - box.x) / size.horizontal);
        const y_factor = Math.round((limited.y - box.y) / size.vertical);
        return Point.from_cartesian(x_factor * size.horizontal + box.x, y_factor * size.vertical + box.y, point.origin_x, point.origin_y);
    }
    grid_lines() {
        const x = [];
        const y = [];
        const size = this.size;
        const box = this._director.settings.box;
        for (let current_x = box.x; current_x < box.width + box.x; current_x += size.horizontal) {
            x.push(current_x);
        }
        for (let current_y = box.y; current_y < box.height + box.y; current_y += size.vertical) {
            y.push(current_y);
        }
        return { x: x, y: y };
    }
    get size() {
        const box = this._director.settings.box;
        return { horizontal: box.width / this._partition.horizontal, vertical: box.height / this._partition.vertical };
    }
}
class LHPassFilter {
    constructor(steep, audio_context) {
        this._gain_node = audio_context.createGain();
        this._gain_node.gain.value = 0;
        this._low_pass = [];
        this._high_pass = [];
        let prev = undefined;
        for (let index = 0; index < steep; index++) {
            const filter = audio_context.createBiquadFilter();
            filter.type = "lowpass";
            filter.Q.value = 0;
            this._low_pass.push(filter);
            if (prev) {
                prev.connect(filter);
            }
            prev = filter;
        }
        for (let index = 0; index < steep; index++) {
            const filter = audio_context.createBiquadFilter();
            filter.type = "highpass";
            filter.Q.value = 0;
            this._high_pass.push(filter);
            if (prev) {
                prev.connect(filter);
            }
            prev = filter;
        }
        prev?.connect(this._gain_node);
    }
    get exit_node() {
        return this._gain_node;
    }
    get enter_node() {
        return this._low_pass[0];
    }
    automate_frequency(low_pass, high_pass, start, duration) {
        this._low_pass.forEach((filter) => {
            filter.frequency.setValueCurveAtTime(low_pass, start, duration);
        });
        this._high_pass.forEach((filter) => {
            filter.frequency.setValueCurveAtTime(high_pass, start, duration);
        });
    }
    automate_gain(amplitude, activated, start, duration) {
        const gain_array = [];
        for (let index = 0; index < activated.length; index++) {
            gain_array.push(activated[index] ? amplitude : 0);
        }
        this._gain_node.gain.setValueCurveAtTime(gain_array, start, duration);
    }
}
class GraphicalInterface {
    constructor(ctx, director) {
        this._ctx = ctx;
        this._director = director;
    }
    set_stroke_style(color) {
        const settings = this._director.settings;
        this._ctx.strokeStyle = color || settings.stroke;
        this._ctx.lineWidth = settings.stroke_thickness;
    }
    set_fill_style(color) {
        this._ctx.fillStyle = color || this._director.settings.fill;
    }
    draw_line(point1, point2) {
        this._ctx.beginPath();
        this._ctx.moveTo(point1.x, point1.y);
        this._ctx.lineTo(point2.x, point2.y);
        this._ctx.stroke();
        this._ctx.closePath();
    }
    clear() {
        this._ctx.clearRect(0, 0, this._ctx.canvas.clientWidth, this._ctx.canvas.clientHeight);
    }
    draw_box() {
        const box = this._director.settings.box;
        this._ctx.strokeRect(box.x, box.y, box.width, box.height);
    }
    draw_grid_lines() {
        const lines = this._director.grid_lines();
        const box = this._director.settings.box;
        this.set_stroke_style(this._director.settings.grid_stroke);
        lines.x.forEach((x) => {
            this.draw_line({ x: x, y: box.y }, { x: x, y: box.y + box.height });
        });
        lines.y.forEach((y) => {
            this.draw_line({ x: box.x, y: y }, { x: box.x + box.width, y: y });
        });
    }
    draw_origin() {
        const settings = this._director.settings;
        this.set_stroke_style();
        this.draw_line({ x: settings.origin.x - settings.origin_size, y: settings.origin.y }, { x: settings.origin.x + settings.origin_size, y: settings.origin.y });
        this.draw_line({ x: settings.origin.x, y: settings.origin.y - settings.origin_size }, { x: settings.origin.x, y: settings.origin.y + settings.origin_size });
    }
    draw_anchors() {
        this.set_stroke_style();
        this.set_fill_style();
        this._director.shape.points.forEach((anchor) => {
            this._ctx.beginPath();
            this._ctx.arc(anchor.x, anchor.y, this._director.settings.anchor_size, 0, Math.PI * 2);
            this._ctx.fill();
            this._ctx.stroke();
            this._ctx.closePath();
        });
    }
    draw_connections(fill = false) {
        if (this._director.shape.points.length == 0) {
            return;
        }
        const shape = this._director.shape;
        this.set_stroke_style();
        this._ctx.beginPath();
        this._ctx.moveTo(shape.points[0].x, shape.points[0].y);
        for (let index = 1; index < shape.points.length; index++) {
            this._ctx.lineTo(shape.points[index].x, shape.points[index].y);
        }
        this._ctx.closePath();
        this._ctx.stroke();
        if (fill) {
            this.set_fill_style(this._director.settings.shape_fill);
            this._ctx.fill("nonzero");
        }
    }
    draw_render_progress() {
        this.set_stroke_style();
        const caret_position = this._director.get_caret_position();
        const box = this._director.settings.box;
        this._ctx.save();
        this._ctx.shadowColor = this._director.settings.stroke;
        this._ctx.shadowBlur = 15;
        this.draw_line({ x: caret_position, y: box.y }, { x: caret_position, y: box.y + box.height });
        this._ctx.restore();
    }
}
class UserInterface {
    constructor(director) {
        this._selected_anchor = -1;
        this._director = director;
    }
    handle_mouse_down(args) {
        const mouse_position = { x: args.offsetX, y: args.offsetY };
        this._selected_anchor = this._director.get_selection(mouse_position);
        if (args.button == 2 && this._selected_anchor != -1) {
            this._director.delete(this._selected_anchor);
            this._selected_anchor = -1;
        }
    }
    handle_mouse_move(args) {
        if (this._selected_anchor != -1) {
            const within_box = this._director.snap_to_grid(Point.from_cartesian(args.offsetX, args.offsetY, this._director.settings.origin.x, this._director.settings.origin.y));
            this._director.replace(this._selected_anchor, within_box);
        }
    }
    handle_mouse_up(args) {
        if (this._selected_anchor == -1 && args.button == 0) {
            const position = this._director.snap_to_grid(Point.from_cartesian(args.offsetX, args.offsetY, this._director.settings.origin.x, this._director.settings.origin.y));
            this._director.insert(position);
            return;
        }
        this._selected_anchor = -1;
    }
}
class FillAudioProcessor {
    constructor(director) {
        this._steep = 12;
        this._filters = [];
        this._audio_context = new AudioContext();
        this._director = director;
        this._rendering = false;
        this._rendering_start = -1;
    }
    get rendering() {
        return this._rendering;
    }
    get current_time() {
        if (!this.rendering) {
            throw new Error("Unable to fetch current time unless render is running");
        }
        return this._audio_context.currentTime - this._rendering_start;
    }
    detach() {
        this._filters.forEach((filter) => {
            filter.exit_node.disconnect(this._audio_context.destination);
        });
    }
    generate_noise(duration) {
        const samples_number = this._audio_context.sampleRate * duration;
        const buffer = this._audio_context.createBuffer(1, samples_number, this._audio_context.sampleRate);
        const time_domain = buffer.getChannelData(0);
        for (let sample_index = 0; sample_index < samples_number; sample_index++) {
            time_domain[sample_index] = Math.random() * 2 - 1;
        }
        const buffer_source = this._audio_context.createBufferSource();
        buffer_source.buffer = buffer;
        return buffer_source;
    }
    add_filters(count) {
        for (let index = 0; index < count; index++) {
            const filter = new LHPassFilter(this._steep, this._audio_context);
            filter.exit_node.connect(this._audio_context.destination);
            this._filters.push(filter);
        }
    }
    fill_gaps(array, last_non_zero) {
        for (let index1 = 0; index1 < array.length; index1++) {
            for (let index2 = array[index1].length - 1; index2 >= 0; index2--) {
                if (array[index1][index2] != -1) {
                    last_non_zero[index1] = array[index1][index2];
                }
                else {
                    array[index1][index2] = last_non_zero[index1];
                }
            }
        }
    }
    transcribe_user_shape(shape) {
        const lower_frequencies = [];
        const upper_frequencies = [];
        const activated = [];
        let last_nonzero_lower = [];
        let last_nonzero_upper = [];
        let counter = 0;
        for (let time_stamp = 0; time_stamp <= this._director.settings.rate; time_stamp += 0.02) {
            const caret_position = this._director.get_caret_position(time_stamp);
            let intersections = shape.find_intersections({ a: 1, b: 0, c: -caret_position });
            intersections.sort((a, b) => {
                if (a.y < b.y) {
                    return 1;
                }
                else if (a.y > b.y) {
                    return -1;
                }
                else {
                    return 0;
                }
            });
            let filter_index = 0;
            for (let index = 0; index < intersections.length - 1; index++) {
                const upper_point = this._director.normalize_linear(intersections[index + 1].y);
                const lower_point = this._director.normalize_linear(intersections[index].y);
                const mid_point = Point.from_cartesian((intersections[index].x + intersections[index + 1].x) / 2, (intersections[index].y + intersections[index + 1].y) / 2, this._director.settings.origin.x, this._director.settings.origin.y);
                if (shape.is_inside(mid_point, "nonzero")) {
                    //filters count compensation
                    if (filter_index >= this._filters.length) {
                        const compensation = filter_index - this._filters.length + 1;
                        const frequency_array_placeholder = new Array(counter);
                        const gain_array_placeholder = new Array(counter);
                        frequency_array_placeholder.fill(-1, 0, counter);
                        gain_array_placeholder.fill(false, 0, counter);
                        for (let index = 0; index < compensation; index++) {
                            lower_frequencies.push(Array.from(frequency_array_placeholder));
                            upper_frequencies.push(Array.from(frequency_array_placeholder));
                            activated.push(Array.from(gain_array_placeholder));
                            last_nonzero_lower.push(0);
                            last_nonzero_upper.push(0);
                        }
                        this.add_filters(compensation);
                    }
                    last_nonzero_lower[filter_index] = lower_point;
                    last_nonzero_upper[filter_index] = upper_point;
                    lower_frequencies[filter_index].push(lower_point);
                    upper_frequencies[filter_index].push(upper_point);
                    activated[filter_index].push(true);
                    filter_index++;
                }
            }
            while (filter_index < this._filters.length) {
                lower_frequencies[filter_index].push(-1);
                upper_frequencies[filter_index].push(-1);
                activated[filter_index].push(false);
                filter_index++;
            }
            counter++;
        }
        this.fill_gaps(lower_frequencies, last_nonzero_lower);
        this.fill_gaps(upper_frequencies, last_nonzero_upper);
        return { lower_frequencies: lower_frequencies, upper_frequencies: upper_frequencies, activated: activated };
    }
    render() {
        const shape = this._director.shape;
        this.detach();
        this._filters = [];
        const transcribed = this.transcribe_user_shape(shape);
        const noise = this.generate_noise(this._director.settings.rate);
        for (let index = 0; index < this._filters.length; index++) {
            this._filters[index].automate_frequency(transcribed.upper_frequencies[index], transcribed.lower_frequencies[index], this._audio_context.currentTime, this._director.settings.rate);
            this._filters[index].automate_gain(0.5 / this._filters.length / this._steep, transcribed.activated[index], this._audio_context.currentTime, this._director.settings.rate);
            noise.connect(this._filters[index].enter_node);
        }
        noise.start();
        this._rendering = true;
        this._rendering_start = this._audio_context.currentTime;
        setTimeout((() => {
            this._rendering = false;
        }).bind(this), this._director.settings.rate * 1000);
    }
}
class Director {
    constructor(settings, partition, drawing_context, audio_processor_type) {
        this._settings = settings;
        this._shape = new Polygon();
        this._grid = new Grid(partition, this);
        this._audio_processor_type = audio_processor_type;
        this._audio_processor = audio_processor_type == "fill" ? new FillAudioProcessor(this) : new FillAudioProcessor(this);
        this._gui_instance = new GraphicalInterface(drawing_context, this);
        this._ui_instance = new UserInterface(this);
    }
    get settings() {
        return this._settings;
    }
    get shape() {
        return this._shape;
    }
    get rendering() {
        return this._audio_processor.rendering;
    }
    //auxiliary
    get_selection(mouse_position) {
        let selected_anchor = -1;
        for (let index = 0; index < this._shape.points.length; index++) {
            if (dist(mouse_position, this._shape.points[index]) <= this._settings.anchor_size + this._settings.stroke_thickness) {
                selected_anchor = index;
            }
        }
        return selected_anchor;
    }
    get_caret_position(time) {
        if (time === undefined) {
            return (this._audio_processor.current_time / this._settings.rate) * this._settings.box.width + this._settings.box.x;
        }
        return (time / this._settings.rate) * this._settings.box.width + this._settings.box.x;
    }
    normalize_linear(value) {
        const bias = Math.log(this._settings.frequency_range.low) / Math.log(this._settings.frequency_range.high);
        const ratio = (value - this._settings.box.y) / this._settings.box.height;
        return Math.pow(this._settings.frequency_range.high, (1 - ratio) * (1 - bias) + bias);
    }
    normalize_exponential(value) {
        const bias = Math.log(this._settings.frequency_range.low) / Math.log(this._settings.frequency_range.high);
        const power = Math.log(value) / Math.log(this._settings.frequency_range.high);
        const ratio = -(power - bias) / (1 - bias) + 1;
        return ratio * this._settings.box.height + this._settings.box.y;
    }
    //shape actions
    delete(index) {
        this._shape.delete(index);
    }
    replace(index, point) {
        this._shape.replace(index, point);
    }
    insert(point) {
        this._shape.insert(point);
    }
    //mouse events
    mouse_down_handler(args) {
        if (this.rendering) {
            return;
        }
        this._ui_instance.handle_mouse_down(args);
    }
    mouse_move_handler(args) {
        if (this.rendering) {
            return;
        }
        this._ui_instance.handle_mouse_move(args);
    }
    mouse_up_handler(args) {
        if (this.rendering) {
            return;
        }
        this._ui_instance.handle_mouse_up(args);
    }
    //grid actions
    snap_to_grid(point) {
        return this._grid.snap_to_grid(point);
    }
    grid_lines() {
        return this._grid.grid_lines();
    }
    //general
    update() {
        this._gui_instance.clear();
        this._gui_instance.draw_box();
        this._gui_instance.draw_grid_lines();
        this._gui_instance.draw_origin();
        this._gui_instance.draw_connections(this._audio_processor_type == "fill");
        this._gui_instance.draw_anchors();
        if (this.rendering) {
            this._gui_instance.draw_render_progress();
        }
        requestAnimationFrame(this.update.bind(this));
    }
    render() {
        if (this.rendering) {
            return;
        }
        this._audio_processor.render(this.shape);
    }
}
function resize(settings) {
    const cnvs = this;
    cnvs.width = window.innerWidth;
    cnvs.height = window.innerHeight;
    const padding = 50;
    settings.box = { x: padding, y: padding, width: cnvs.width - 2 * padding, height: cnvs.height - 2 * padding };
    settings.origin = { x: cnvs.width / 2, y: cnvs.height / 2 };
}
window.onload = () => {
    const canvas = document.getElementById("cnvs");
    const drawing_context = canvas?.getContext("2d");
    const render_button = document.getElementById("renderbtn");
    if (!drawing_context) {
        throw new Error("Failed to get canvas drawing context");
    }
    if (!render_button) {
        throw new Error("Failed to locate render button");
    }
    const settings = new Settings();
    const director = new Director(settings, { horizontal: 24, vertical: 12 }, drawing_context, "fill");
    canvas.onmousedown = director.mouse_down_handler.bind(director);
    canvas.onmousemove = director.mouse_move_handler.bind(director);
    canvas.onmouseup = director.mouse_up_handler.bind(director);
    resize.call(canvas, settings);
    director.update();
    render_button.onclick = () => {
        director.render.call(director);
    };
    window.onresize = resize.bind(canvas, settings);
};
