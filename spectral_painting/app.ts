const settings = {
	frequency_range: { low: 50, high: 20000 },
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

function resize()
{
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

	public static from_polar(angle: number, radius: number, origin_x: number, origin_y: number)
	{
		return new Point(angle, radius, origin_x, origin_y);
	}
	public static from_cartesian(x: number, y: number, origin_x: number, origin_y: number)
	{
		const angle = Math.atan2(y - origin_y, x - origin_x);

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

const anchors: Point[] = [];
let audio_context = new AudioContext();
let oscilators: OscillatorNode[] = [];
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
function draw_render_progress(ctx: CanvasRenderingContext2D)
{
	set_stroke_style(ctx);

	const caret_position = audio_context.currentTime / settings.rate * settings.box.width + settings.box.x;

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
function update()
{
	this.clearRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
	draw_box(this);
	draw_origin(this);
	draw_connections(this);
	draw_anchors(this);

	if (rendering)
	{
		draw_render_progress(this);
	}

	requestAnimationFrame(update.bind(this));
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
function limit_coords(position: CartesianPoint): CartesianPoint
{
	const x = Math.min(Math.max(position.x, settings.box.x), settings.box.x + settings.box.width);
	const y = Math.min(Math.max(position.y, settings.box.y), settings.box.y + settings.box.height);

	return { x: x, y: y }
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
		const limited = limit_coords({ x: args.offsetX, y: args.offsetY });
		anchors[selected_anchor] = Point.from_cartesian(limited.x, limited.y, settings.origin.x, settings.origin.y)
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
		const limited = limit_coords({ x: args.offsetX, y: args.offsetY });
		const position = Point.from_cartesian(limited.x, limited.y, settings.origin.x, settings.origin.y);
		const insert_index = find_insert_index(position);

		anchors.splice(insert_index, 0, position);
		return;
	}

	selected_anchor = -1;
}

function init_oscilators()
{
	audio_context.close();
	audio_context = new AudioContext();
	audio_context.suspend();
	oscilators = [];

	for (let i = 0; i < anchors.length; i++)
	{
		const oscilator = audio_context.createOscillator();
		const gain = audio_context.createGain();

		gain.gain.setValueAtTime(0.75 / anchors.length, audio_context.currentTime);
		oscilator.type = "sine";
		oscilator.connect(gain);
		gain.connect(audio_context.destination);
		oscilators.push(oscilator);
	}
}
function get_caret_position(time_stamp: number): number
{
	return (time_stamp / settings.rate) * settings.box.width + settings.box.x;
}
function normalize(position: number): number
{
	const bias = Math.log(settings.frequency_range.low) / Math.log(settings.frequency_range.high);
	const ratio = (position - settings.box.y) / settings.box.height;

	return Math.pow(settings.frequency_range.high, (1 - ratio) * (1 - bias) + bias);
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
function transcribe_user_shape(): { frequencies: number[][], markers: { start: number, end: number }[] }
{
	const frequencies: number[][] = [];
	const markers: { start: number, end: number }[] = [];

	for (let index = 0; index < oscilators.length; index++)
	{
		frequencies.push([]);
	}

	for (let index = 0; index < anchors.length; index++)
	{
		for (let time_stamp = 0; time_stamp <= settings.rate; time_stamp += 0.001)
		{
			const caret_position = get_caret_position(time_stamp);
			const anchor1 = anchors[index];
			const anchor2 = anchors[(index + 1) % anchors.length];
			const shifted_time = audio_context.currentTime + time_stamp;

			const intersection = find_intersection(caret_position, anchor1, anchor2);

			if (intersection === undefined)
			{
				if (frequencies[index].length != 0)
				{
					markers[index].end = shifted_time;
					break;
				}
			}
			else
			{
				if (frequencies[index].length == 0)
				{
					markers[index] = { start: shifted_time, end: audio_context.currentTime + settings.rate };
				}
				frequencies[index].push(normalize(intersection.y));
			}
		}
	}

	return { frequencies: frequencies, markers: markers };
}
function render()
{
	if (rendering)
	{
		return;
	}
	init_oscilators();

	const transcribed = transcribe_user_shape();

	for (let index = 0; index < oscilators.length; index++)
	{
		oscilators[index].frequency.setValueCurveAtTime(transcribed.frequencies[index],
			transcribed.markers[index].start,
			(transcribed.markers[index].end - transcribed.markers[index].start));
		oscilators[index].start(transcribed.markers[index].start);
		oscilators[index].stop(transcribed.markers[index].end);
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
	ctx = cnvs.getContext("2d");

	cnvs.onmousedown = mouse_down;
	cnvs.onmousemove = mouse_move;
	cnvs.onmouseup = mouse_up;

	resize();
	update.call(ctx);
}

window.onresize = resize;