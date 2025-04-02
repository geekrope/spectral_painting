﻿type CartesianPoint = { x: number, y: number };
type AudioProcessorType = "fill" | "outline";

function dist(point1: CartesianPoint, point2: CartesianPoint)
{
	return Math.sqrt(Math.pow(point1.x - point2.x, 2) + Math.pow(point1.y - point2.y, 2));
}
function angle(point1: CartesianPoint, point2: CartesianPoint, origin: CartesianPoint)
{
	const vector1 = { x: point1.x - origin.x, y: point1.y - origin.y };
	const vector2 = { x: point2.x - origin.x, y: point2.y - origin.y };

	return Math.acos((vector1.x * vector2.x + vector1.y * vector2.y) / dist(point1, origin) / dist(point2, origin));
}

interface AudioProcessor
{
	get current_time(): number;
	get rendering(): boolean;
	render(shape: Polygon): void;
}

class Settings
{
	public frequency_range: { low: number, high: number } = { low: 65, high: 20000 };
	public rate: number = 5;
	public box: { x: number, y: number, width: number, height: number } = { x: 100, y: 100, width: 500, height: 500 };
	public origin: { x: number, y: number } = { x: 350, y: 350 };
	public anchor_size: number = 5;
	public origin_size: number = 5;
	public fill: string = "white";
	public shape_fill: string = "#ececec";
	public stroke: string = "#0349fc";
	public stroke_thickness: number = 1;
}
class Point
{
	private _angle: number;
	private _radius: number;
	private _origin_x: number;
	private _origin_y: number;

	public get angle()
	{
		return this._angle;
	}
	public get radius()
	{
		return this._radius;
	}
	public get x()
	{
		return Math.cos(this._angle) * this._radius + this._origin_x;
	}
	public get y()
	{
		return Math.sin(this._angle) * this._radius + this._origin_y;
	}
	public get origin_x()
	{
		return this._origin_x;
	}
	public get origin_y()
	{
		return this._origin_y;
	}

	public static from_polar(angle: number, radius: number, origin_x: number, origin_y: number)
	{
		return new Point(angle, radius, origin_x, origin_y);
	}
	public static from_cartesian(x: number, y: number, origin_x: number, origin_y: number)
	{
		const angle = (Math.atan2(y - origin_y, x - origin_x) + 2 * Math.PI) % (2 * Math.PI);

		return new Point(angle, dist({ x: x, y: y }, { x: origin_x, y: origin_y }), origin_x, origin_y);
	}

	private constructor(angle: number, radius: number, origin_x: number, origin_y: number)
	{
		this._angle = angle;
		this._radius = radius;
		this._origin_x = origin_x;
		this._origin_y = origin_y;
	}
}
class Polygon
{
	private _points: Point[];

	public get points(): ReadonlyArray<Point>
	{
		return this._points;
	}

	private check_bounds(index: number)
	{
		if (index < 0 || index >= this._points.length)
		{
			throw new Error("Index out of bounds");
		}
	}
	private find_insert_index(point: Point)
	{
		for (let index = 0; index < this._points.length; index++)
		{
			if (point.angle < this._points[index].angle)
			{
				return index;
			}
		}

		return this._points.length;
	}

	public find_weighted_intersections(line: { a: number, b: number, c: number }): { point: CartesianPoint, x_axis_angle: number }[]
	{
		const intersections: { point: CartesianPoint, x_axis_angle: number }[] = [];

		for (let index = 0; index < this._points.length; index++)
		{
			const point1 = this._points[index];
			const point2 = this._points[(index + 1) % this._points.length];

			const a = (-point1.y + point2.y);
			const b = (point1.x - point2.x);
			const c = -a * point1.x - b * point1.y;

			const left_bound = Math.min(point1.x, point2.x);
			const right_bound = Math.max(point1.x, point2.x);
			const intersection_x = (line.b * c - b * line.c) / (line.a * b - a * line.b);
			const intersection_y = (line.a * c - a * line.c) / (a * line.b - line.a * b);
			const segment_angle = Math.atan2(-a, b);

			if (intersection_x >= left_bound && intersection_x <= right_bound && isFinite(intersection_x) && isFinite(intersection_y))
			{
				intersections.push({ point: { x: intersection_x, y: intersection_y }, x_axis_angle: segment_angle });
			}
		}
		return intersections;
	}
	public find_intersections(line: { a: number, b: number, c: number }): CartesianPoint[]
	{
		const intersections = this.find_weighted_intersections(line);
		const projection = Array<CartesianPoint>(intersections.length);

		intersections.forEach((intersection, index) =>
		{
			projection[index] = intersection.point;
		});

		return projection;
	}
	public is_inside(point: Point, rule: "evenodd" | "nonzero")
	{
		switch (rule)
		{
			case "evenodd":
				const intersections = this.find_intersections({ a: 1, b: 0, c: -point.x });
				let count = 0;

				for (let index = 0; index < intersections.length; index++)
				{
					if (intersections[index].y < point.y)
					{
						count++;
					}
				}

				return count % 2 != 0;
			case "nonzero":
				const weighted_intersections = this.find_weighted_intersections({ a: 0, b: 1, c: -point.y });
				let winding_number = 0;

				for (let index = 0; index < weighted_intersections.length; index++)
				{
					const intersection = weighted_intersections[index];
					if (intersection.point.x >= point.x)
					{
						winding_number += intersection.x_axis_angle > 0 ? 1 : -1;
					}
				}

				return winding_number != 0;
			default:
				throw new Error("Not implemented");
		}

	}
	public insert(point: Point)
	{
		this._points.splice(this.find_insert_index(point), 0, point);
	}
	public delete(index: number)
	{
		this.check_bounds(index);
		this._points.splice(index, 1);
	}
	public replace(index: number, value: Point)
	{
		this.check_bounds(index);
		this._points[index] = value;
	}

	public constructor()
	{
		this._points = [];
	}
}
class LHPassFilter
{
	private _low_pass: BiquadFilterNode[];
	private _high_pass: BiquadFilterNode[];
	private _gain_node: GainNode;

	public get exit_node(): AudioNode
	{
		return this._gain_node;
	}
	public get enter_node(): AudioNode
	{
		return this._low_pass[0];
	}

	public automate_frequency(lower: number[], upper: number[], start: number, duration: number)
	{
		this._low_pass.forEach((filter) =>
		{
			filter.frequency.setValueCurveAtTime(lower, start, duration);
		});
		this._high_pass.forEach((filter) =>
		{
			filter.frequency.setValueCurveAtTime(upper, start, duration);
		});
	}
	public automate_gain(amplitude: number, activated: boolean[], start: number, duration: number)
	{
		const gain_array = [];

		for (let index = 0; index < activated.length; index++)
		{
			gain_array.push(activated[index] ? amplitude : 0);
		}

		this._gain_node.gain.setValueCurveAtTime(gain_array, start, duration);
	}

	public constructor(steep: number, audio_context: AudioContext)
	{
		this._gain_node = audio_context.createGain();
		this._gain_node.gain.value = 0;
		this._low_pass = [];
		this._high_pass = [];

		let prev: BiquadFilterNode | undefined = undefined;
		for (let index = 0; index < steep; index++)
		{
			const filter = audio_context.createBiquadFilter();
			filter.type = "lowpass";
			this._low_pass.push(filter);

			if (prev)
			{
				prev.connect(filter);
			}
			prev = filter;
		}
		for (let index = 0; index < steep; index++)
		{
			const filter = audio_context.createBiquadFilter();
			filter.type = "highpass";
			this._high_pass.push(filter);

			if (prev)
			{
				prev.connect(filter);
			}
			prev = filter;
		}
		prev?.connect(this._gain_node);
	}
}
class GraphicalInterface
{
	private _ctx: CanvasRenderingContext2D;
	private _director: Director;

	private set_stroke_style()
	{
		this._ctx.strokeStyle = this._director.settings.stroke;
		this._ctx.lineWidth = this._director.settings.stroke_thickness;
	}
	private set_fill_style()
	{
		this._ctx.fillStyle = this._director.settings.fill;
	}
	private set_shape_fill_style()
	{
		this._ctx.fillStyle = this._director.settings.shape_fill;
	}

	public clear()
	{
		this._ctx.clearRect(0, 0, this._ctx.canvas.clientWidth, this._ctx.canvas.clientHeight);
	}
	public draw_box()
	{
		this._ctx.strokeRect(this._director.settings.box.x, this._director.settings.box.y, this._director.settings.box.width, this._director.settings.box.height)
	}
	public draw_origin()
	{
		this.set_stroke_style();
		this._ctx.beginPath();
		this._ctx.moveTo(this._director.settings.origin.x - this._director.settings.origin_size, this._director.settings.origin.y);
		this._ctx.lineTo(this._director.settings.origin.x + this._director.settings.origin_size, this._director.settings.origin.y);
		this._ctx.moveTo(this._director.settings.origin.x, this._director.settings.origin.y - this._director.settings.origin_size);
		this._ctx.lineTo(this._director.settings.origin.x, this._director.settings.origin.y + this._director.settings.origin_size);
		this._ctx.stroke();
		this._ctx.closePath();
	}
	public draw_anchors()
	{
		this.set_stroke_style();
		this.set_fill_style();

		this._director.shape.points.forEach((anchor: { x: number, y: number }) =>
		{
			this._ctx.beginPath();
			this._ctx.arc(anchor.x, anchor.y, this._director.settings.anchor_size, 0, Math.PI * 2);
			this._ctx.fill();
			this._ctx.stroke();
			this._ctx.closePath();
		})
	}
	public draw_connections(fill: boolean = false)
	{
		if (this._director.shape.points.length == 0)
		{
			return;
		}

		this.set_stroke_style();
		this._ctx.beginPath();
		this._ctx.moveTo(this._director.shape.points[0].x, this._director.shape.points[0].y);

		for (let index = 1; index < this._director.shape.points.length; index++)
		{
			this._ctx.lineTo(this._director.shape.points[index].x, this._director.shape.points[index].y);
		}

		this._ctx.closePath();
		this._ctx.stroke();

		if (fill)
		{
			this.set_shape_fill_style();
			this._ctx.fill("nonzero");
		}
	}
	public draw_render_progress()
	{
		this.set_stroke_style();

		const caret_position = this._director.get_caret_position();

		this._ctx.save();
		this._ctx.shadowColor = this._director.settings.stroke;
		this._ctx.shadowBlur = 15;

		this._ctx.beginPath();
		this._ctx.moveTo(caret_position, this._director.settings.box.y);
		this._ctx.lineTo(caret_position, this._director.settings.box.y + this._director.settings.box.height);
		this._ctx.stroke();
		this._ctx.closePath();

		this._ctx.restore();
	}

	public constructor(ctx: CanvasRenderingContext2D, director: Director)
	{
		this._ctx = ctx;
		this._director = director;
	}
}
class UserInterface
{
	private _selected_anchor: number;
	private _director: Director;

	public limit_coords_within_box(position: Point): Point
	{
		const x = Math.min(Math.max(position.x, this._director.settings.box.x), this._director.settings.box.x + this._director.settings.box.width);
		const y = Math.min(Math.max(position.y, this._director.settings.box.y), this._director.settings.box.y + this._director.settings.box.height);

		return Point.from_cartesian(x, y, position.origin_x, position.origin_y);
	}
	public handle_mouse_down(args: MouseEvent)
	{
		const mouse_position = { x: args.offsetX, y: args.offsetY };
		this._selected_anchor = this._director.get_selection(mouse_position);

		if (args.button == 2 && this._selected_anchor != -1)
		{
			this._director.delete(this._selected_anchor);
			this._selected_anchor = -1;
		}
	}
	public handle_mouse_move(args: MouseEvent)
	{
		if (this._selected_anchor != -1)
		{
			const within_box = this.limit_coords_within_box(Point.from_cartesian(args.offsetX, args.offsetY, this._director.settings.origin.x, this._director.settings.origin.y));

			this._director.replace(this._selected_anchor, within_box);
		}
	}
	public handle_mouse_up(args: MouseEvent)
	{
		if (this._selected_anchor == -1 && args.button == 0)
		{
			const position = this.limit_coords_within_box(Point.from_cartesian(args.offsetX, args.offsetY, this._director.settings.origin.x, this._director.settings.origin.y));
			this._director.insert(position);

			return;
		}

		this._selected_anchor = -1;
	}

	public constructor(director: Director)
	{
		this._selected_anchor = -1;
		this._director = director;
	}
}
class FillAudioProcessor implements AudioProcessor
{
	private _filters: LHPassFilter[];
	private _audio_context: AudioContext;
	private _director: Director;
	private _rendering: boolean;
	private _rendering_start: number;

	public get rendering(): boolean
	{
		return this._rendering;
	}
	public get current_time(): number
	{
		if (!this.rendering)
		{
			throw new Error("Unable to fetch current time unless render is running")
		}

		return this._audio_context.currentTime - this._rendering_start;
	}

	private detach()
	{
		this._filters.forEach((filter) =>
		{
			filter.exit_node.disconnect(this._audio_context.destination);
		})
	}
	private generate_noise(duration: number): AudioBufferSourceNode
	{
		const samples_number = this._audio_context.sampleRate * duration;
		const buffer = this._audio_context.createBuffer(1, samples_number, this._audio_context.sampleRate);
		const time_domain = buffer.getChannelData(0);

		for (let sample_index = 0; sample_index < samples_number; sample_index++)
		{
			time_domain[sample_index] = Math.random() * 2 - 1;
		}

		const buffer_source = this._audio_context.createBufferSource();
		buffer_source.buffer = buffer;

		return buffer_source;
	}
	private initialize_filters(count: number)
	{
		this.detach();
		this._filters = [];

		for (let index = 0; index < count; index++)
		{
			const filter = new LHPassFilter(6, this._audio_context);

			filter.exit_node.connect(this._audio_context.destination);
			this._filters.push(filter);
		}
	}
	private transcribe_user_shape(shape: Polygon): { lower_frequencies: number[][], upper_frequencies: number[][], activated: boolean[][] }
	{
		const lower_frequencies: number[][] = [];
		const upper_frequencies: number[][] = [];
		const activated: boolean[][] = [];

		for (let index = 0; index < this._filters.length; index++)
		{
			lower_frequencies.push([]);
			upper_frequencies.push([]);
			activated.push([]);
		}
		for (let time_stamp = 0; time_stamp <= this._director.settings.rate; time_stamp += 0.001)
		{
			const caret_position = this._director.get_caret_position(time_stamp);
			let intersections = shape.find_intersections({ a: 1, b: 0, c: -caret_position });

			intersections.sort((a: CartesianPoint, b: CartesianPoint) =>
			{
				if (a.y < b.y) { return -1; }
				else if (a.y > b.y) { return 1; }
				else { return 0; }
			});

			//?????
			//if (intersections.length % 2 != 0)
			//{
			//	intersections = [];
			//}

			let filter_index = 0;

			for (let index = 0; index < intersections.length - 1; index++)
			{
				const upper_point = this._director.normalize_linear(intersections[index + 1].y);
				const lower_point = this._director.normalize_linear(intersections[index].y);
				const mid_point = Point.from_cartesian(
					(intersections[index].x + intersections[index + 1].x) / 2,
					(intersections[index].y + intersections[index + 1].y) / 2,
					this._director.settings.origin.x,
					this._director.settings.origin.y);

				if (shape.is_inside(mid_point, "nonzero"))
				{
					lower_frequencies[filter_index].push(lower_point);
					upper_frequencies[filter_index].push(upper_point);
					activated[filter_index].push(true);
					filter_index++;
				}
			}

			while (filter_index < this._filters.length)
			{
				lower_frequencies[filter_index].push(this._director.settings.frequency_range.low);
				upper_frequencies[filter_index].push(this._director.settings.frequency_range.high);
				activated[filter_index].push(false);
				filter_index++;
			}
		}

		return { lower_frequencies: lower_frequencies, upper_frequencies: upper_frequencies, activated: activated };
	}

	public render()
	{
		const shape = this._director.shape;
		this.initialize_filters(shape.points.length);

		const transcribed = this.transcribe_user_shape(shape);
		const noise = this.generate_noise(this._director.settings.rate);

		for (let index = 0; index < this._filters.length; index++)
		{
			this._filters[index].automate_frequency(transcribed.lower_frequencies[index], transcribed.upper_frequencies[index], this._audio_context.currentTime, this._director.settings.rate);
			this._filters[index].automate_gain(0.75 / this._filters.length, transcribed.activated[index], this._audio_context.currentTime, this._director.settings.rate);
			noise.connect(this._filters[index].enter_node);
		}

		noise.start();

		this._rendering = true;
		this._rendering_start = this._audio_context.currentTime;

		setTimeout((() =>
		{
			this._rendering = false;
		}).bind(this), this._director.settings.rate * 1000);
	}

	public constructor(director: Director)
	{
		this._filters = [];
		this._audio_context = new AudioContext();
		this._director = director;
		this._rendering = false;
		this._rendering_start = -1;
	}
}
class Director
{
	private _settings: Settings;
	private _shape: Polygon;
	private _audio_processor: AudioProcessor;
	private _gui_instance: GraphicalInterface;
	private _ui_instance: UserInterface;
	private _audio_processor_type: AudioProcessorType;

	public get settings(): Settings
	{
		return this._settings;
	}
	public get shape(): Polygon
	{
		return this._shape;
	}
	public get rendering(): boolean
	{
		return this._audio_processor.rendering;
	}

	//auxiliary
	public get_selection(mouse_position: { x: number, y: number }): number
	{
		let selected_anchor = -1;

		for (let index = 0; index < this._shape.points.length; index++)
		{
			if (dist(mouse_position, this._shape.points[index]) <= this._settings.anchor_size + this._settings.stroke_thickness)
			{
				selected_anchor = index;
			}
		}

		return selected_anchor;
	}
	public get_caret_position(): number
	public get_caret_position(time: number): number
	public get_caret_position(time?: number): number
	{
		if (time === undefined)
		{
			return (this._audio_processor.current_time / this._settings.rate) * this._settings.box.width + this._settings.box.x;
		}
		return (time / this._settings.rate) * this._settings.box.width + this._settings.box.x;
	}
	public normalize_linear(value: number): number
	{
		const bias = Math.log(this._settings.frequency_range.low) / Math.log(this._settings.frequency_range.high);
		const ratio = (value - this._settings.box.y) / this._settings.box.height;

		return Math.pow(this._settings.frequency_range.high, (1 - ratio) * (1 - bias) + bias);
	}
	public normalize_exponential(value: number): number
	{
		const bias = Math.log(this._settings.frequency_range.low) / Math.log(this._settings.frequency_range.high);
		const power = Math.log(value) / Math.log(this._settings.frequency_range.high);
		const ratio = -(power - bias) / (1 - bias) + 1;

		return ratio * this._settings.box.height + this._settings.box.y;
	}
	//shape actions
	public delete(index: number)
	{
		this._shape.delete(index);
	}
	public replace(index: number, point: Point)
	{
		this._shape.replace(index, point);
	}
	public insert(point: Point)
	{
		this._shape.insert(point);
	}
	//mouse events
	public mouse_down_handler(args: MouseEvent)
	{
		if (this.rendering)
		{
			return;
		}
		this._ui_instance.handle_mouse_down(args);
	}
	public mouse_move_handler(args: MouseEvent)
	{
		if (this.rendering)
		{
			return;
		}
		this._ui_instance.handle_mouse_move(args);
	}
	public mouse_up_handler(args: MouseEvent)
	{
		if (this.rendering)
		{
			return;
		}
		this._ui_instance.handle_mouse_up(args);
	}
	//general
	public update()
	{
		this._gui_instance.clear();
		this._gui_instance.draw_box();
		this._gui_instance.draw_origin();
		this._gui_instance.draw_connections(this._audio_processor_type == "fill");
		this._gui_instance.draw_anchors();

		if (this.rendering)
		{
			this._gui_instance.draw_render_progress();
		}

		requestAnimationFrame(this.update.bind(this));
	}
	public render()
	{
		if (this.rendering)
		{
			return;
		}
		this._audio_processor.render(this.shape);
	}

	public constructor(settings: Settings, drawing_context: CanvasRenderingContext2D, audio_processor_type: AudioProcessorType)
	{
		this._settings = settings;
		this._shape = new Polygon();
		this._audio_processor_type = audio_processor_type;
		this._audio_processor = audio_processor_type == "fill" ? new FillAudioProcessor(this) : new FillAudioProcessor(this);
		this._gui_instance = new GraphicalInterface(drawing_context, this);
		this._ui_instance = new UserInterface(this);
	}
}

function resize(this: HTMLCanvasElement, settings: Settings)
{
	const cnvs = this as HTMLCanvasElement;
	cnvs.width = window.innerWidth;
	cnvs.height = window.innerHeight;

	const padding = 50;
	settings.box = { x: padding, y: padding, width: cnvs.width - 2 * padding, height: cnvs.height - 2 * padding };
	settings.origin = { x: cnvs.width / 2, y: cnvs.height / 2 };
}

window.onload = () =>
{
	const canvas = document.getElementById("cnvs") as HTMLCanvasElement;
	const drawing_context = canvas?.getContext("2d");
	const render_button = document.getElementById("renderbtn");

	if (!drawing_context)
	{
		throw new Error("Failed to get canvas drawing context");
	}
	if (!render_button)
	{
		throw new Error("Failed to locate render button");
	}

	const settings = new Settings();
	const director = new Director(settings, drawing_context, "fill");

	canvas.onmousedown = director.mouse_down_handler.bind(director);
	canvas.onmousemove = director.mouse_move_handler.bind(director);
	canvas.onmouseup = director.mouse_up_handler.bind(director);

	resize.call(canvas, settings);
	director.update();

	render_button.onclick = () =>
	{
		director.render.call(director);
	};

	window.onresize = resize.bind(canvas, settings);
}