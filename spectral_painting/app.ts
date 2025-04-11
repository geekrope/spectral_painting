type CartesianPoint = { x: number, y: number };
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

abstract class ProcessorNode
{
	protected _gain_node: GainNode;

	public get exit_node(): AudioNode
	{
		return this._gain_node;
	}
	public abstract get enter_node(): AudioNode;

	public automate_gain(amplitude: number, activated: boolean[], start: number, duration: number)
	{
		const gain_array = [];

		for (let index = 0; index < activated.length; index++)
		{
			gain_array.push(activated[index] ? amplitude : 0);
		}

		this._gain_node.gain.setValueCurveAtTime(gain_array, start, duration);
	}

	public constructor(audio_context: AudioContext)
	{
		this._gain_node = audio_context.createGain();
		this._gain_node.gain.value = 0;
	}
}

interface AudioProcessor
{
	get current_time(): number;
	get rendering(): boolean;
	get audio_context(): AudioContext;
	get master(): AudioNode;
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
	public grid_stroke: string = "#add8e6";
	public stroke_thickness: number = 1;
	public spectrum_frame_size: number = 5;
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
	private line_equation(point1: Point, point2: Point): { a: number, b: number, c: number }
	{
		const a = (-point1.y + point2.y);
		const b = (point1.x - point2.x);
		const c = -a * point1.x - b * point1.y;

		return { a: a, b: b, c: c };
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

			const line_equation = this.line_equation(point1, point2);

			const left_bound = Math.min(point1.x, point2.x);
			const right_bound = Math.max(point1.x, point2.x);
			const intersection_x = (line.b * line_equation.c - line_equation.b * line.c) / (line.a * line_equation.b - line_equation.a * line.b);
			const intersection_y = (line.a * line_equation.c - line_equation.a * line.c) / (line_equation.a * line.b - line.a * line_equation.b);
			const segment_angle = Math.atan2(-line_equation.a, line_equation.b);

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
	public lies_on_side(point: Point)
	{
		const epsilon = 1e-6;
		for (let index = 0; index < this._points.length; index++)
		{
			const point1 = this._points[index];
			const point2 = this._points[(index + 1) % this._points.length];
			const left_bound = Math.min(point1.x, point2.x);
			const right_bound = Math.max(point1.x, point2.x);

			const line_equation = this.line_equation(point1, point2);

			if (Math.abs(line_equation.a * point.x + line_equation.b * point.y + line_equation.c) < epsilon && point.x >= left_bound && point.x <= right_bound)
			{
				return true;
			}
		}

		return false;
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

class Grid
{
	private _partition: { horizontal: number, vertical: number };
	private _director: Director;

	public limit_coords_within_box(position: Point): Point
	{
		const x = Math.min(Math.max(position.x, this._director.settings.box.x), this._director.settings.box.x + this._director.settings.box.width);
		const y = Math.min(Math.max(position.y, this._director.settings.box.y), this._director.settings.box.y + this._director.settings.box.height);

		return Point.from_cartesian(x, y, position.origin_x, position.origin_y);
	}
	public snap_to_grid(point: Point)
	{
		const box = this._director.settings.box;
		const limited = this.limit_coords_within_box(point);
		const size = this.size;
		const x_factor = Math.round((limited.x - box.x) / size.horizontal);
		const y_factor = Math.round((limited.y - box.y) / size.vertical);

		return Point.from_cartesian(x_factor * size.horizontal + box.x, y_factor * size.vertical + box.y, point.origin_x, point.origin_y);
	}
	public grid_lines(): { x: number[], y: number[] }
	{
		const x: number[] = [];
		const y: number[] = [];
		const size = this.size;
		const box = this._director.settings.box;

		for (let current_x = box.x; current_x < box.width + box.x; current_x += size.horizontal)
		{
			x.push(current_x);
		}
		for (let current_y = box.y; current_y < box.height + box.y; current_y += size.vertical)
		{
			y.push(current_y);
		}

		return { x: x, y: y };
	}

	public get size()
	{
		const box = this._director.settings.box;
		return { horizontal: box.width / this._partition.horizontal, vertical: box.height / this._partition.vertical };
	}

	public constructor(partition: { horizontal: number, vertical: number }, director: Director)
	{
		this._partition = partition;
		this._director = director;
	}
}

class LHPassFilter extends ProcessorNode
{
	private _low_pass: BiquadFilterNode[];
	private _high_pass: BiquadFilterNode[];

	public get enter_node(): AudioNode
	{
		return this._low_pass[0];
	}

	public automate_frequency(low_pass: number[], high_pass: number[], start: number, duration: number)
	{
		this._low_pass.forEach((filter) =>
		{
			filter.frequency.setValueCurveAtTime(low_pass, start, duration);
		});
		this._high_pass.forEach((filter) =>
		{
			filter.frequency.setValueCurveAtTime(high_pass, start, duration);
		});
	}

	public constructor(steep: number, audio_context: AudioContext)
	{
		super(audio_context);
		this._low_pass = [];
		this._high_pass = [];

		let prev: BiquadFilterNode | undefined = undefined;
		for (let index = 0; index < steep; index++)
		{
			const filter = audio_context.createBiquadFilter();
			filter.type = "lowpass";
			filter.Q.value = 0;

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
			filter.Q.value = 0;

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

class HarmonicOscilator extends ProcessorNode
{
	private _oscilator: OscillatorNode;

	public get enter_node(): AudioNode
	{
		return this._oscilator;
	}

	public automate_frequency(frequencies: number[], start: number, duration: number)
	{
		this._oscilator.frequency.setValueCurveAtTime(frequencies, start, duration);
	}
	public activate(start: number, end: number)
	{
		this._oscilator.start(start);
		this._oscilator.stop(end);
	}

	public constructor(audio_context: AudioContext)
	{
		super(audio_context);

		this._oscilator = audio_context.createOscillator();
		this._oscilator.type = "sine";
		this._oscilator.connect(this._gain_node);
	}
}

class SpectrumData
{
	private _analyser: AnalyserNode;
	private _director: Director;
	private _last_update: number;

	public get last_update(): number
	{
		return this._last_update;
	}
	public get analyser(): AnalyserNode
	{
		return this._analyser;
	}

	public get_frequency_data(): Float32Array
	{
		const data = new Float32Array(this._analyser.frequencyBinCount);

		this._analyser.getFloatFrequencyData(data);
		this._last_update = this._director.current_time;

		return data;
	}

	public constructor(master: AudioNode, director: Director)
	{
		this._director = director;
		this._last_update = -1;
		this._analyser = new AnalyserNode(director.audio_context, { fftSize: 8192, minDecibels: -120, maxDecibels: 0 });
		//this._analyser.connect(director.audio_context.destination);
		master.connect(this._analyser);
	}
}

class SpectrumImager
{
	private _ctx: CanvasRenderingContext2D;
	private _spectrum_data: SpectrumData;
	private _director: Director;

	public draw_spectrum()
	{
		const last_update = this._spectrum_data.last_update == -1 ? 0 : this._spectrum_data.last_update;
		const data = this._spectrum_data.get_frequency_data();
		const current_time = this._director.current_time;
		const settings = this._director.settings;
		const x = Math.floor(this._ctx.canvas.width * (last_update % settings.spectrum_frame_size) / settings.spectrum_frame_size);
		const width = Math.ceil(this._ctx.canvas.width * (current_time - last_update) / settings.spectrum_frame_size);
		let prev_y = this._ctx.canvas.height;

		data.forEach((amplitude, index) =>
		{
			const frequency = (index + 1) / this._spectrum_data.analyser.frequencyBinCount * this._director.audio_context.sampleRate;

			const y = Math.floor(this._director.normalize_exponential(frequency) * this._ctx.canvas.height);
			const normalised_amplitude = Math.max(0, 255 * (amplitude - this._spectrum_data.analyser.minDecibels) / (this._spectrum_data.analyser.maxDecibels - this._spectrum_data.analyser.minDecibels));

			this._ctx.fillStyle = `rgb(${normalised_amplitude},${normalised_amplitude},0)`;

			if (prev_y > y)
			{
				this._ctx.fillRect(x, y, width, prev_y - y);
				prev_y = y;
			}
		});
	}

	public constructor(ctx: CanvasRenderingContext2D, spectrum_data: SpectrumData, director: Director)
	{
		this._ctx = ctx;
		this._spectrum_data = spectrum_data;
		this._director = director;
	}
}

class GraphicalInterface
{
	private _ctx: CanvasRenderingContext2D;
	private _director: Director;

	private set_stroke_style(): void
	private set_stroke_style(color: string): void
	private set_stroke_style(color?: string): void
	{
		const settings = this._director.settings;
		this._ctx.strokeStyle = color || settings.stroke;
		this._ctx.lineWidth = settings.stroke_thickness;
	}
	private set_fill_style(): void
	private set_fill_style(color: string): void
	private set_fill_style(color?: string): void
	{
		this._ctx.fillStyle = color || this._director.settings.fill;
	}

	private draw_line(point1: CartesianPoint, point2: CartesianPoint)
	{
		this._ctx.beginPath();
		this._ctx.moveTo(point1.x, point1.y);
		this._ctx.lineTo(point2.x, point2.y);
		this._ctx.stroke();
		this._ctx.closePath();
	}

	public clear()
	{
		this._ctx.clearRect(0, 0, this._ctx.canvas.clientWidth, this._ctx.canvas.clientHeight);
	}
	public draw_box()
	{
		const box = this._director.settings.box;
		this._ctx.strokeRect(box.x, box.y, box.width, box.height)
	}
	public draw_grid_lines()
	{
		const lines = this._director.grid_lines();
		const box = this._director.settings.box;

		this.set_stroke_style(this._director.settings.grid_stroke);

		lines.x.forEach((x: number) =>
		{
			this.draw_line({ x: x, y: box.y }, { x: x, y: box.y + box.height });
		});
		lines.y.forEach((y: number) =>
		{
			this.draw_line({ x: box.x, y: y }, { x: box.x + box.width, y: y });
		});
	}
	public draw_origin()
	{
		const settings = this._director.settings;
		this.set_stroke_style();
		this.draw_line({ x: settings.origin.x - settings.origin_size, y: settings.origin.y },
			{ x: settings.origin.x + settings.origin_size, y: settings.origin.y });
		this.draw_line({ x: settings.origin.x, y: settings.origin.y - settings.origin_size },
			{ x: settings.origin.x, y: settings.origin.y + settings.origin_size });
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

		const shape = this._director.shape;

		this.set_stroke_style();
		this._ctx.beginPath();
		this._ctx.moveTo(shape.points[0].x, shape.points[0].y);

		for (let index = 1; index < shape.points.length; index++)
		{
			this._ctx.lineTo(shape.points[index].x, shape.points[index].y);
		}

		this._ctx.closePath();
		this._ctx.stroke();

		if (fill)
		{
			this.set_fill_style(this._director.settings.shape_fill);
			this._ctx.fill("nonzero");
		}
	}
	public draw_render_progress()
	{
		this.set_stroke_style();

		const caret_position = this._director.get_caret_position();
		const box = this._director.settings.box;

		this._ctx.save();
		this._ctx.shadowColor = this._director.settings.stroke;
		this._ctx.shadowBlur = 15;
		this.draw_line({ x: caret_position, y: box.y }, { x: caret_position, y: box.y + box.height });
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
			const within_box = this._director.snap_to_grid(Point.from_cartesian(args.offsetX, args.offsetY, this._director.settings.origin.x, this._director.settings.origin.y));

			this._director.replace(this._selected_anchor, within_box);
		}
	}
	public handle_mouse_up(args: MouseEvent)
	{
		if (this._selected_anchor == -1 && args.button == 0)
		{
			const position = this._director.snap_to_grid(Point.from_cartesian(args.offsetX, args.offsetY, this._director.settings.origin.x, this._director.settings.origin.y));
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
	private _steep: number = 12;
	private _filters: LHPassFilter[];
	private _master: GainNode;
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
	public get audio_context(): AudioContext
	{
		return this._audio_context;
	}
	public get master(): AudioNode
	{
		return this._master;
	}

	private detach()
	{
		this._filters.forEach((filter) =>
		{
			filter.exit_node.disconnect(this._master);
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
	private add_filters(count: number)
	{
		for (let index = 0; index < count; index++)
		{
			const filter = new LHPassFilter(this._steep, this._audio_context);

			filter.exit_node.connect(this._master);
			this._filters.push(filter);
		}
	}
	private fill_gaps(array: number[][], last_non_zero: number[])
	{
		for (let index1 = 0; index1 < array.length; index1++)
		{
			for (let index2 = array[index1].length - 1; index2 >= 0; index2--)
			{
				if (array[index1][index2] != -1)
				{
					last_non_zero[index1] = array[index1][index2];
				}
				else
				{
					array[index1][index2] = last_non_zero[index1];
				}
			}
		}
	}
	private transcribe_user_shape(shape: Polygon): { lower_frequencies: number[][], upper_frequencies: number[][], activated: boolean[][] }
	{
		const lower_frequencies: number[][] = [];
		const upper_frequencies: number[][] = [];
		const activated: boolean[][] = [];

		let last_nonzero_lower: number[] = [];
		let last_nonzero_upper: number[] = [];
		let counter = 0;

		for (let time_stamp = 0; time_stamp <= this._director.settings.rate; time_stamp += 0.01)
		{
			const caret_position = this._director.get_caret_position(time_stamp);
			let intersections = shape.find_intersections({ a: 1, b: 0, c: -caret_position });

			intersections.sort((a: CartesianPoint, b: CartesianPoint) =>
			{
				if (a.y < b.y) { return 1; }
				else if (a.y > b.y) { return -1; }
				else { return 0; }
			});

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
					//filters count compensation
					if (filter_index >= this._filters.length)
					{
						const compensation = filter_index - this._filters.length + 1;
						const frequency_array_placeholder = new Array<number>(counter);
						const gain_array_placeholder = new Array<boolean>(counter);

						frequency_array_placeholder.fill(-1, 0, counter);
						gain_array_placeholder.fill(false, 0, counter);

						for (let index = 0; index < compensation; index++)
						{
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

			while (filter_index < this._filters.length)
			{
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

	public render()
	{
		const shape = this._director.shape;

		this.detach();
		this._filters = [];

		const transcribed = this.transcribe_user_shape(shape);
		const noise = this.generate_noise(this._director.settings.rate);

		for (let index = 0; index < this._filters.length; index++)
		{
			this._filters[index].automate_frequency(transcribed.upper_frequencies[index], transcribed.lower_frequencies[index], this._audio_context.currentTime, this._director.settings.rate);
			this._filters[index].automate_gain(0.5 / this._filters.length / this._steep, transcribed.activated[index], this._audio_context.currentTime, this._director.settings.rate);
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
		this._master = new GainNode(this._audio_context, { gain: 1 });
		this._master.connect(this._audio_context.destination);
		this._director = director;
		this._rendering = false;
		this._rendering_start = -1;
	}
}

class OutlineAudioProcessor implements AudioProcessor
{
	private _oscilators: HarmonicOscilator[];
	private _audio_context: AudioContext;
	private _master: GainNode;
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
	public get audio_context(): AudioContext
	{
		return this._audio_context;
	}
	public get master(): AudioNode
	{
		return this._master;
	}

	private detach()
	{
		this._oscilators.forEach((oscilator) =>
		{
			oscilator.exit_node.disconnect(this._master);
		})
	}
	private add_oscilators(count: number)
	{
		for (let index = 0; index < count; index++)
		{
			const oscilator = new HarmonicOscilator(this._audio_context);

			oscilator.exit_node.connect(this._master);
			this._oscilators.push(oscilator);
		}
	}
	private fill_gaps(array: number[][], last_non_zero: number[])
	{
		for (let index1 = 0; index1 < array.length; index1++)
		{
			for (let index2 = array[index1].length - 1; index2 >= 0; index2--)
			{
				if (array[index1][index2] != -1)
				{
					last_non_zero[index1] = array[index1][index2];
				}
				else
				{
					array[index1][index2] = last_non_zero[index1];
				}
			}
		}
	}
	private transcribe_user_shape(shape: Polygon): { frequencies: number[][], activated: boolean[][] }
	{
		const frequencies: number[][] = [];
		const last_nonzero: number[] = [];
		const activated: boolean[][] = [];
		let counter = 0;

		for (let time_stamp = 0; time_stamp <= this._director.settings.rate; time_stamp += 0.01)
		{
			const caret_position = this._director.get_caret_position(time_stamp);
			let intersections = shape.find_intersections({ a: 1, b: 0, c: -caret_position });

			intersections.sort((a: CartesianPoint, b: CartesianPoint) =>
			{
				if (a.y < b.y) { return 1; }
				else if (a.y > b.y) { return -1; }
				else { return 0; }
			});

			//oscilators count compensation
			if (intersections.length > this._oscilators.length)
			{
				const compensation = intersections.length - this._oscilators.length;
				const frequency_array_placeholder = new Array<number>(counter);
				const gain_array_placeholder = new Array<boolean>(counter);

				frequency_array_placeholder.fill(-1, 0, counter);
				gain_array_placeholder.fill(false, 0, counter);

				for (let index = 0; index < compensation; index++)
				{
					frequencies.push(Array.from(frequency_array_placeholder));
					activated.push(Array.from(gain_array_placeholder));

					last_nonzero.push(0);
				}

				this.add_oscilators(compensation);
			}

			let oscilator_index = 0

			while (oscilator_index < intersections.length)
			{
				const point = this._director.normalize_linear(intersections[oscilator_index].y);

				last_nonzero[oscilator_index] = point;

				frequencies[oscilator_index].push(point);
				activated[oscilator_index].push(true);
				oscilator_index++;
			}

			while (oscilator_index < this._oscilators.length)
			{
				frequencies[oscilator_index].push(-1);
				activated[oscilator_index].push(false);
				oscilator_index++;
			}

			counter++;
		}

		this.fill_gaps(frequencies, last_nonzero);

		return { frequencies: frequencies, activated: activated };
	}

	public render()
	{
		const shape = this._director.shape;

		this.detach();
		this._oscilators = [];

		const transcribed = this.transcribe_user_shape(shape);

		for (let index = 0; index < this._oscilators.length; index++)
		{
			this._oscilators[index].automate_frequency(transcribed.frequencies[index], this._audio_context.currentTime, this._director.settings.rate);
			this._oscilators[index].automate_gain(0.75 / this._oscilators.length, transcribed.activated[index], this._audio_context.currentTime, this._director.settings.rate);
		}

		for (let index = 0; index < this._oscilators.length; index++)
		{
			this._oscilators[index].activate(this._audio_context.currentTime, this._audio_context.currentTime + this._director.settings.rate);
		}

		this._rendering = true;
		this._rendering_start = this._audio_context.currentTime;

		setTimeout((() =>
		{
			this._rendering = false;
		}).bind(this), this._director.settings.rate * 1000);
	}

	public constructor(director: Director)
	{
		this._oscilators = [];
		this._audio_context = new AudioContext();
		this._master = new GainNode(this._audio_context, { gain: 1 });
		this._master.connect(this._audio_context.destination);
		this._director = director;
		this._rendering = false;
		this._rendering_start = -1;
	}
}

class Director
{
	private _settings: Settings;
	private _shape: Polygon;
	private _grid: Grid;
	private _audio_processor: AudioProcessor;
	private _spectrum_data: SpectrumData;
	private _spectrum_imager: SpectrumImager;
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
	public get audio_context(): AudioContext
	{
		return this._audio_processor.audio_context;
	}
	public get current_time(): number
	{
		return this._audio_processor.current_time;
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

		return ratio;
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
	//grid actions
	public snap_to_grid(point: Point)
	{
		return this._grid.snap_to_grid(point);
	}
	public grid_lines()
	{
		return this._grid.grid_lines();
	}
	//general
	public update()
	{
		this._gui_instance.clear();
		this._gui_instance.draw_box();
		this._gui_instance.draw_grid_lines();
		this._gui_instance.draw_origin();
		this._gui_instance.draw_connections(this._audio_processor_type == "fill");
		this._gui_instance.draw_anchors();

		if (this.rendering)
		{
			this._gui_instance.draw_render_progress();
			this._spectrum_imager.draw_spectrum();
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

	public constructor(settings: Settings, partition: { horizontal: number, vertical: number }, drawing_context: CanvasRenderingContext2D, spectrum_drawing_context: CanvasRenderingContext2D, audio_processor_type: AudioProcessorType)
	{
		this._settings = settings;
		this._shape = new Polygon();
		this._grid = new Grid(partition, this);
		this._audio_processor_type = audio_processor_type;
		this._audio_processor = audio_processor_type == "fill" ? new FillAudioProcessor(this) : new OutlineAudioProcessor(this);
		this._gui_instance = new GraphicalInterface(drawing_context, this);
		this._ui_instance = new UserInterface(this);
		this._spectrum_data = new SpectrumData(this._audio_processor.master, this);
		this._spectrum_imager = new SpectrumImager(spectrum_drawing_context, this._spectrum_data, this);
	}
}

let spectrum_width_ajdustment = false;
let spectrum_height_ajdustment = false;
const spectrum_margin = 5;

function resize_main(this: HTMLCanvasElement, settings: Settings)
{
	const cnvs = this as HTMLCanvasElement;
	cnvs.width = window.innerWidth;
	cnvs.height = window.innerHeight;

	const padding = 50;
	settings.box = { x: padding, y: padding, width: cnvs.width - 2 * padding, height: cnvs.height - 2 * padding };
	settings.origin = { x: cnvs.width / 2, y: cnvs.height / 2 };
}
function mousedown_spectrum(this: HTMLCanvasElement, args: MouseEvent)
{
	spectrum_width_ajdustment = args.offsetX < spectrum_margin;
	spectrum_height_ajdustment = args.offsetY < spectrum_margin;
}
function spectrum_cursor_update(this: HTMLCanvasElement, args: MouseEvent)
{
	if (spectrum_width_ajdustment || spectrum_height_ajdustment)
	{
		return;
	}

	if (args.offsetX < spectrum_margin && args.offsetY < spectrum_margin)
	{
		this.style.cursor = "nw-resize";
	}
	else if (args.offsetX < spectrum_margin)
	{
		this.style.cursor = "w-resize";
	}
	else if (args.offsetY < spectrum_margin)
	{
		this.style.cursor = "n-resize";
	}
	else
	{
		this.style.cursor = "default";
	}
}
function mouseleave_spectrum(this: HTMLCanvasElement, _args: MouseEvent)
{
	if (spectrum_width_ajdustment || spectrum_height_ajdustment)
	{
		return;
	}

	this.style.cursor = "default";
}
function mousemove_spectrum(this: HTMLCanvasElement, args: MouseEvent)
{
	const min_width = 200;
	const min_height = 100;
	const box = this.getBoundingClientRect();

	if (spectrum_width_ajdustment)
	{
		this.width = Math.max(box.right - args.clientX, min_width);
		args.stopPropagation();
	}
	if (spectrum_height_ajdustment)
	{
		this.height = Math.max(box.bottom - args.clientY, min_height);
		args.stopPropagation();
	}
}
function mouseup_spectrum(this: HTMLCanvasElement, args: MouseEvent)
{
	if (spectrum_width_ajdustment || spectrum_height_ajdustment)
	{
		spectrum_width_ajdustment = false;
		spectrum_height_ajdustment = false;
		this.style.cursor = "default";
		args.stopPropagation();
	}
}

window.onload = () =>
{
	const canvas = document.getElementById("cnvs") as HTMLCanvasElement;
	const spectrum_canvas = document.getElementById("spectrum_cnvs") as HTMLCanvasElement;
	const drawing_context = canvas?.getContext("2d");
	const spectrum_drawing_context = spectrum_canvas?.getContext("2d");
	const render_button = document.getElementById("renderbtn");
	const params = new URLSearchParams(window.location.search);
	const type = params.get("type") || "fill";

	if (!drawing_context)
	{
		throw new Error("Failed to get canvas drawing context");
	}
	if (!spectrum_drawing_context)
	{
		throw new Error("Failed to get spectrum canvas drawing context");
	}
	if (!render_button)
	{
		throw new Error("Failed to locate render button");
	}

	const settings = new Settings();
	const director = new Director(settings, { horizontal: 48, vertical: 24 }, drawing_context, spectrum_drawing_context, type as AudioProcessorType);

	canvas.onmousedown = director.mouse_down_handler.bind(director);
	canvas.onmousemove = director.mouse_move_handler.bind(director);
	canvas.onmouseup = director.mouse_up_handler.bind(director);

	spectrum_canvas.onmousedown = mousedown_spectrum.bind(spectrum_canvas);
	spectrum_canvas.onmousemove = spectrum_cursor_update.bind(spectrum_canvas);
	spectrum_canvas.onmouseleave = mouseleave_spectrum.bind(spectrum_canvas);
	window.addEventListener("mousemove", mousemove_spectrum.bind(spectrum_canvas));
	window.addEventListener("mouseup", mouseup_spectrum.bind(spectrum_canvas));

	resize_main.call(canvas, settings);
	director.update();

	render_button.onclick = () =>
	{
		director.render.call(director);
	};

	window.onresize = resize_main.bind(canvas, settings);
}