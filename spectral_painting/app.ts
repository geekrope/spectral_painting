const settings = {
	frequency_range: { low: 65, high: 20000 },
	rate: 5,
	box: { x: 100, y: 100, width: 500, height: 500 },
	origin: { x: 350, y: 350 },
	anchor_size: 5,
	origin_size: 5,
	fill: "white",
	stroke: "#0349fc",
	stroke_thickness: 1
}

type CartesianPoint = { x: number, y: number };

let cnvs: HTMLCanvasElement | undefined = undefined;
let ctx: CanvasRenderingContext2D | undefined = undefined;

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

function resize(this: HTMLCanvasElement)
{
	const cnvs = this as HTMLCanvasElement;
	cnvs.width = window.innerWidth;
	cnvs.height = window.innerHeight;

	const padding = 50;
	settings.box = { x: padding, y: padding, width: cnvs.width - 2 * padding, height: cnvs.height - 2 * padding };
	settings.origin = { x: cnvs.width / 2, y: cnvs.height / 2 };
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

	public automate_frequency(frequencies: { low: number, high: number }[], start: number, duration: number)
	{
		const low_array: number[] = [];
		const high_array: number[] = [];

		for (let index = 0; index < frequencies.length; index++)
		{
			low_array.push(frequencies[index].low);
			high_array.push(frequencies[index].high);
		}

		this._low_pass.forEach((filter) =>
		{
			filter.frequency.setValueCurveAtTime(low_array, start, duration);
		});
		this._high_pass.forEach((filter) =>
		{
			filter.frequency.setValueCurveAtTime(high_array, start, duration);
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

const anchors: Point[] = [];
let audio_context: AudioContext = new AudioContext();
let filters: LHPassFilter[] = [];
let rendering = false;

function set_stroke_style(ctx: CanvasRenderingContext2D)
{
	ctx.strokeStyle = settings.stroke;
	ctx.lineWidth = settings.stroke_thickness;
}
function set_fill_style(ctx: CanvasRenderingContext2D)
{
	ctx.fillStyle = settings.fill;
}
function draw_box(ctx: CanvasRenderingContext2D)
{
	ctx.strokeRect(settings.box.x, settings.box.y, settings.box.width, settings.box.height)
}
function draw_origin(ctx: CanvasRenderingContext2D)
{
	set_stroke_style(ctx);
	ctx.beginPath();
	ctx.moveTo(settings.origin.x - settings.origin_size, settings.origin.y);
	ctx.lineTo(settings.origin.x + settings.origin_size, settings.origin.y);
	ctx.moveTo(settings.origin.x, settings.origin.y - settings.origin_size);
	ctx.lineTo(settings.origin.x, settings.origin.y + settings.origin_size);
	ctx.stroke();
	ctx.closePath();
}
function draw_anchors(ctx: CanvasRenderingContext2D)
{
	set_stroke_style(ctx);
	set_fill_style(ctx);

	anchors.forEach((anchor: { x: number, y: number }) =>
	{
		ctx.beginPath();
		ctx.arc(anchor.x, anchor.y, settings.anchor_size, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
		ctx.closePath();
	})
}
function draw_connections(ctx: CanvasRenderingContext2D)
{
	set_stroke_style(ctx);

	for (let index = 0; index < anchors.length; index++)
	{
		const adjacent_index = (index + 1) % anchors.length;
		ctx.beginPath();
		ctx.moveTo(anchors[index].x, anchors[index].y);
		ctx.lineTo(anchors[adjacent_index].x, anchors[adjacent_index].y);
		ctx.stroke();
		ctx.closePath();
	}
}
function draw_render_progress(time: number, ctx: CanvasRenderingContext2D)
{
	set_stroke_style(ctx);

	const caret_position = time / settings.rate * settings.box.width + settings.box.x;

	ctx.save();
	ctx.shadowColor = settings.stroke;
	ctx.shadowBlur = 15;

	ctx.beginPath();
	ctx.moveTo(caret_position, settings.box.y);
	ctx.lineTo(caret_position, settings.box.y + settings.box.height);
	ctx.stroke();
	ctx.closePath();

	ctx.restore();
}
function update(this: CanvasRenderingContext2D, audio_context: AudioContext)
{
	const ctx = this as CanvasRenderingContext2D;
	ctx.clearRect(0, 0, ctx.canvas.clientWidth, ctx.canvas.clientHeight);
	draw_box(ctx);
	draw_origin(ctx);
	draw_connections(ctx);
	draw_anchors(ctx);

	if (rendering)
	{
		draw_render_progress(audio_context.currentTime, ctx);
	}

	requestAnimationFrame(update.bind(ctx, audio_context));
}

let selected_anchor = -1;

function find_insert_index(position: Point): number
{
	for (let index = 0; index < anchors.length; index++)
	{
		if (position.angle < anchors[index].angle)
		{
			return index;
		}
	}

	return anchors.length;
}
function limit_coords_within_box(position: Point): Point
{
	const x = Math.min(Math.max(position.x, settings.box.x), settings.box.x + settings.box.width);
	const y = Math.min(Math.max(position.y, settings.box.y), settings.box.y + settings.box.height);

	return Point.from_cartesian(x, y, position.origin_x, position.origin_y);
}
function mouse_down(args: MouseEvent)
{
	if (rendering)
	{
		return;
	}

	const mouse_position = { x: args.offsetX, y: args.offsetY };

	for (let index = 0; index < anchors.length; index++)
	{
		if (dist(mouse_position, anchors[index]) <= settings.anchor_size + settings.stroke_thickness)
		{
			selected_anchor = index;
		}
	}

	if (args.button == 2 && selected_anchor != -1)
	{
		anchors.splice(selected_anchor, 1);
		selected_anchor = -1;
	}
}
function mouse_move(args: MouseEvent)
{
	if (rendering)
	{
		return;
	}

	if (selected_anchor != -1)
	{
		const within_box = limit_coords_within_box(Point.from_cartesian(args.offsetX, args.offsetY, settings.origin.x, settings.origin.y));

		anchors[selected_anchor] = within_box;
	}
}
function mouse_up(args: MouseEvent)
{
	if (rendering)
	{
		return;
	}

	if (selected_anchor == -1 && args.button == 0)
	{
		const position = limit_coords_within_box(Point.from_cartesian(args.offsetX, args.offsetY, settings.origin.x, settings.origin.y));
		const insert_index = find_insert_index(position);

		anchors.splice(insert_index, 0, position);
		return;
	}

	selected_anchor = -1;
}

function generate_noise(audio_context: AudioContext, duration: number): AudioBufferSourceNode
{
	const samples_number = audio_context.sampleRate * duration;
	const buffer = audio_context.createBuffer(1, samples_number, audio_context.sampleRate);
	const time_domain = buffer.getChannelData(0);

	for (let sample_index = 0; sample_index < samples_number; sample_index++)
	{
		time_domain[sample_index] = Math.random() * 2 - 1;
	}

	const buffer_source = audio_context.createBufferSource();
	buffer_source.buffer = buffer;

	return buffer_source;
}
function init_filters(audio_context: AudioContext)
{
	audio_context.suspend();
	filters = [];

	for (let i = 0; i < anchors.length; i++)
	{
		const filter = new LHPassFilter(4, audio_context);

		filter.exit_node.connect(audio_context.destination);
		filters.push(filter);
	}
}
function get_caret_position(time_stamp: number): number
{
	return (time_stamp / settings.rate) * settings.box.width + settings.box.x;
}
function normalize_linear(value: number): number
{
	const bias = Math.log(settings.frequency_range.low) / Math.log(settings.frequency_range.high);
	const ratio = (value - settings.box.y) / settings.box.height;

	return Math.pow(settings.frequency_range.high, (1 - ratio) * (1 - bias) + bias);
}
function normalize_exponential(value: number): number
{
	const bias = Math.log(settings.frequency_range.low) / Math.log(settings.frequency_range.high);
	const power = Math.log(value) / Math.log(settings.frequency_range.high);
	const ratio = -(power - bias) / (1 - bias) + 1;

	return ratio * settings.box.height + settings.box.y;
}
function find_intersection(position: number, anchor1: Point, anchor2: Point): CartesianPoint | undefined
{
	const a = (-anchor1.y + anchor2.y);
	const b = (anchor1.x - anchor2.x);
	const c = -a * anchor1.x - b * anchor1.y;

	const left_bound = Math.min(anchor1.x, anchor2.x);
	const right_bound = Math.max(anchor1.x, anchor2.x);
	const intersection_y = (-c - a * position) / b;

	if (position >= left_bound && position <= right_bound && isFinite(intersection_y))
	{
		return { x: position, y: intersection_y };
	}
	else
	{
		return undefined;
	}
}
function transcribe_user_shape(): { frequencies: { low: number, high: number }[][], activated: boolean[][] }
{
	const frequencies: { low: number, high: number }[][] = [];
	const activated: boolean[][] = [];

	for (let index = 0; index < filters.length; index++)
	{
		frequencies.push([]);
		activated.push([]);
	}

	for (let time_stamp = 0; time_stamp <= settings.rate; time_stamp += 0.001)
	{
		const intersections = [];
		const caret_position = get_caret_position(time_stamp);

		for (let index = 0; index < anchors.length; index++)
		{
			const anchor1 = anchors[index];
			const anchor2 = anchors[(index + 1) % anchors.length];
			const intersection = find_intersection(caret_position, anchor1, anchor2);

			if (intersection)
			{
				intersections.push(intersection);
			}
		}

		intersections.sort((a: CartesianPoint, b: CartesianPoint) =>
		{
			if (a.y < b.y) { return -1; }
			else if (a.y > b.y) { return 1; }
			else { return 0; }
		});

		if (intersections.length % 2 != 0)
		{
			for (let index = 0; index < filters.length; index++)
			{
				frequencies[index].push({ low: settings.frequency_range.low, high: settings.frequency_range.high });
				activated[index].push(false);
			}
		}
		else
		{
			for (let index = 0; index < filters.length; index++)
			{
				if (index + 1 < intersections.length)
				{
					frequencies[index].push({
						low: normalize_linear(intersections[index].y),
						high: normalize_linear(intersections[index + 1].y)
					});
					activated[index].push(true);
				}
				else
				{
					frequencies[index].push({ low: settings.frequency_range.low, high: settings.frequency_range.high });
					activated[index].push(false);
				}
			}
		}
	}

	return { frequencies: frequencies, activated: activated };
}
function render()
{
	if (rendering)
	{
		return;
	}

	const noise = generate_noise(audio_context, settings.rate);
	noise.start();

	init_filters(audio_context);

	const transcribed = transcribe_user_shape();

	for (let index = 0; index < filters.length; index++)
	{
		filters[index].automate_frequency(transcribed.frequencies[index], audio_context.currentTime, settings.rate);
		filters[index].automate_gain(0.75 / filters.length, transcribed.activated[index], audio_context.currentTime, settings.rate);
		noise.connect(filters[index].enter_node);
	}

	audio_context.resume();
	rendering = true;
	setTimeout(() =>
	{
		audio_context.suspend();
		rendering = false;
	}, settings.rate * 1000);
}

window.onload = () =>
{
	cnvs = document.getElementById("cnvs") as HTMLCanvasElement;
	if (!cnvs)
	{
		throw new Error("Failed to locate canvas element");
	}

	const context = cnvs.getContext("2d");
	if (!context)
	{
		throw new Error("Failed to get canvas drawing context");
	}
	ctx = context;

	cnvs.onmousedown = mouse_down;
	cnvs.onmousemove = mouse_move;
	cnvs.onmouseup = mouse_up;

	resize.call(cnvs);
	update.call(ctx, audio_context);

	window.onresize = resize.bind(cnvs);
}