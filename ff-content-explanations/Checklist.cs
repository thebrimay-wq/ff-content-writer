	public class UnsafeChecklist 
	{
		public List<ChecklistSection> Sections { get; set; } = new List<ChecklistSection>();
	}

	public class ChecklistSection
	{
		public Guid Id { get; set; }
		public string Title { get; set; }
		public string Description { get; set; }
		public List<ChecklistItem> Items { get; set; } = new List<ChecklistItem>();
		public ChecklistHighlight? Tip { get; set; }		
	}

	public class ChecklistItem
	{
		public Guid Id { get; set; }
		public string Label { get; set; }
		public List<string>? SubItems { get; set; }
		public bool? IsChecked { get; set; }
	}

	public class ChecklistHighlight
	{
		public string? Image { get; set; }
		public string? Title { get; set; }
		public string? Description { get; set; }
	}